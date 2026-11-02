import io
import json
from pathlib import Path
import tempfile
import time
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask, abort, g, request
from routes.uploads import uploads_bp
from services.upload_policy import MAX_FILE_BYTES, UploadError, validate_upload
from services.upload_service import UploadService
from services.upload_store import LocalUploadStore, GCSUploadStore
from test_file_import import apkg

USER = 'fixture-user-one'
OTHER = 'fixture-user-two'


def pdf(text='Hello local PDF extraction.', image=False, padding=0):
    stream = b'q 100 0 0 100 0 0 cm /Im0 Do Q' if image else f'BT /F1 12 Tf 50 750 Td ({text}) Tj ET'.encode()
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream',
        b'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x00\nendstream']
    if padding:
        objects.append(b'<< /Length '+str(padding).encode()+b' >>\nstream\n'+b' '*padding+b'\nendstream')
    result, offsets = b'%PDF-1.4\n', [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(result)); result += f'{index} 0 obj\n'.encode()+value+b'\nendobj\n'
    start = len(result)
    result += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    result += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return result + f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LocalUploadStore(self.tmp.name)
        self.service = UploadService(self.store)

    def tearDown(self): self.tmp.cleanup()

    def receive(self, data, filename='vocabulary.csv', workflow='file'):
        ticket = self.service.initialize(USER, {'filename': filename, 'size': len(data), 'workflow': workflow})
        key, _ = self.service.key(USER, ticket['upload_id'])
        self.store.receive(key, io.BytesIO(data), ticket['content_type'])
        return ticket['upload_id'], key

    def test_exact_boundary_authorizations(self):
        for size in [1, 10*1024**2, 31*1024**2, 49*1024**2, 50*1024**2]:
            with self.subTest(size=size):
                ticket = self.service.initialize(USER, {'filename': 'a.csv', 'size': size, 'workflow': 'file'})
                self.assertEqual(ticket['max_file_bytes'], 52428800)
                self.assertEqual(ticket['transport'], 'local-put')
        for size in [0, -1, MAX_FILE_BYTES+1, True, '50']:
            with self.subTest(size=size), self.assertRaises(UploadError):
                self.service.initialize(USER, {'filename': 'a.csv', 'size': size, 'workflow': 'file'})

    def test_small_upload_parse_receipt_and_duplicate_finalization_zero_ai(self):
        upload, key = self.receive('word,translation\ngrüßen,问候\n'.encode())
        with patch('google.generativeai.GenerativeModel') as model, patch('google.generativeai.upload_file') as ai:
            first = self.service.process(USER, upload, {'workflow': 'file'})
            self.assertEqual(first['rows'], [['grüßen', '问候']])
            self.assertFalse(self.store.path(key).exists())
            self.assertEqual(self.service.process(USER, upload, {'workflow': 'file'}), first)
            ai.assert_not_called(); model.assert_not_called()

    def test_actual_10_31_49_50_mib_csv_transfer_and_parse(self):
        head, chunk = b'word,translation\n', b'hello,' + b' ' * 11991 + b'hi\n'
        for size in [10, 31, 49, 50]:
            with self.subTest(mib=size):
                target = size*1024**2
                count, tail = divmod(target-len(head), len(chunk))
                rest = (b'hello,' + b' '*(tail-9) + b'hi\n') if tail >= 9 else b'\n'*tail
                data = head + chunk*count + rest
                self.assertEqual(len(data), target)
                upload, _ = self.receive(data)
                result = self.service.process(USER, upload, {'workflow': 'file'})
                self.assertGreater(result['count'], 800)
                self.assertEqual(result['rows'][0], ['hello', 'hi'])

    def test_wrong_user_object_substitution_and_generation_change(self):
        upload, key = self.receive(b'word\nhello\n')
        with self.assertRaises(UploadError) as error:
            self.service.process(OTHER, upload, {'workflow': 'file'})
        self.assertEqual(error.exception.status, 404)
        with self.assertRaises(UploadError): self.service.key(USER, '../file.csv')
        with self.assertRaises(UploadError) as error:
            self.service.process(USER, upload, {'workflow': 'article'})
        self.assertEqual(error.exception.status, 403)
        original = self.store.download
        def replaced(key, destination, metadata):
            self.store.path(key).write_bytes(b'substituted')
            return original(key, destination, metadata)
        with patch.object(self.store, 'download', side_effect=replaced), self.assertRaises(UploadError) as error:
            self.service.process(USER, upload, {'workflow': 'file'})
        self.assertEqual(error.exception.status, 409)

    def test_spoofed_types_invalid_extensions_and_size_metadata(self):
        for name in ['bad.exe', '../bad.csv', 'no-extension']:
            with self.assertRaises(UploadError): validate_upload({'filename': name, 'size': 1, 'workflow': 'file'})
        upload, key = self.receive(b'%PDF-1.4\nnot a csv')
        with self.assertRaises(UploadError): self.service.process(USER, upload, {'workflow': 'file'})
        meta = self.store.path(key+'.meta')
        claims = json.loads(meta.read_text()); claims['size'] += 1; meta.write_text(json.dumps(claims))
        with self.assertRaises(UploadError): self.service.process(USER, upload, {'workflow': 'file'})

    def test_interrupted_expired_cancelled_and_processing_claim(self):
        ticket = self.service.initialize(USER, {'filename': 'x.txt', 'size': 100, 'workflow': 'file'})
        key, _ = self.service.key(USER, ticket['upload_id'])
        with self.assertRaises(UploadError): self.store.receive(key, io.BytesIO(b'short'), 'text/plain')
        self.assertFalse(self.store.path(key+'.partial').exists())
        claims = self.store.describe(key); claims['upload_expires'] = time.time()-1
        self.store.path(key+'.meta').write_text(json.dumps(claims))
        with self.assertRaises(UploadError) as error: self.store.receive(key, io.BytesIO(b'x'*100), 'text/plain')
        self.assertEqual(error.exception.status, 410)
        self.service.cancel(USER, ticket['upload_id'])
        self.assertFalse(self.store.path(key+'.meta').exists())
        upload, key = self.receive(b'word\nhello\n')
        self.store.claim(key, self.store.describe(key))
        with self.assertRaises(UploadError) as error: self.service.process(USER, upload, {'workflow': 'file'})
        self.assertEqual(error.exception.status, 409)
        self.store.release(key, None)

    def test_empty_or_oversized_stored_object_rejected_before_parser(self):
        upload, key = self.receive(b'word\nhello\n')
        with patch.object(self.store, 'describe', return_value={**self.store.describe(key), 'actual_size': MAX_FILE_BYTES+1}), patch('services.upload_service.parse_vocabulary') as parser:
            with self.assertRaises(UploadError) as error: self.service.process(USER, upload, {'workflow': 'file'})
            self.assertEqual(error.exception.status, 413); parser.assert_not_called()

    def test_text_pdf_no_ai_and_image_only_requires_consent(self):
        with patch('google.generativeai.GenerativeModel') as model, patch('google.generativeai.upload_file') as ai:
            upload, _ = self.receive(pdf(), 'text.pdf', 'article')
            result = self.service.process(USER, upload, {'workflow': 'article'})
            self.assertIn('Hello local PDF', result['text']); self.assertFalse(result['needs_ocr'])
            upload, key = self.receive(pdf(image=True), 'scan.pdf', 'article')
            result = self.service.process(USER, upload, {'workflow': 'article'})
            self.assertTrue(result['needs_ocr']); self.assertTrue(result['ai_allowed'])
            self.assertTrue(self.store.path(key).exists())
            with self.assertRaises(UploadError): self.service.process(USER, upload, {'workflow': 'article', 'method': 'ai'})
            ai.assert_not_called(); model.assert_not_called()

    def test_article_txt_markdown_preview_unicode_limits_and_zero_ai(self):
        with patch('google.generativeai.upload_file') as ai:
            for extension in ('txt', 'md', 'markdown'):
                with self.subTest(extension=extension):
                    upload, key = self.receive('\ufeff# Häuser\r\nGrüße 世界.'.encode(), 'article.'+extension, 'article')
                    result = self.service.process(USER, upload, {'workflow': 'article'})
                    self.assertEqual(result['text'], '# Häuser\nGrüße 世界.')
                    self.assertFalse(result['needs_ocr']); self.assertFalse(result['ai_allowed'])
                    self.assertFalse(self.store.path(key).exists())
                    self.assertEqual(self.service.process(USER, upload, {'workflow': 'article'}), result)
            ai.assert_not_called()
        upload, _ = self.receive(b'a'*100000, 'limit.txt', 'article')
        self.assertEqual(len(self.service.process(USER, upload, {'workflow':'article'})['text']), 100000)
        upload, _ = self.receive(b'a'*100001, 'over.md', 'article')
        with self.assertRaisesRegex(UploadError, '100,000'):
            self.service.process(USER, upload, {'workflow':'article'})

    def test_article_text_rejects_binary_encoding_empty_and_wrong_owner(self):
        for content in (b'\xff\xfe', b'hello\x00world', b'   ', b'%PDF-1.4\nspoof'):
            with self.subTest(content=content):
                upload, _ = self.receive(content, 'invalid.md', 'article')
                with self.assertRaises(UploadError): self.service.process(USER, upload, {'workflow':'article'})
        upload, _ = self.receive(b'Private article text.', 'owner.markdown', 'article')
        with self.assertRaises(UploadError) as error:
            self.service.process(OTHER, upload, {'workflow':'article'})
        self.assertEqual(error.exception.status, 404)

    def test_apkg_with_media_is_parsed_without_media_execution(self):
        upload, _ = self.receive(apkg(), 'deck.apkg')
        result = self.service.process(USER, upload, {'workflow': 'file'})
        self.assertIn('grüßen', result['rows'][0])

    def test_actual_50_mib_pdf_and_apkg_unused_media(self):
        # A valid one-page PDF with an unreferenced stream; compressed APKG with
        # stored unused media. Neither requires larger parser budgets.
        document = pdf(padding=MAX_FILE_BYTES-1000)
        document = pdf(padding=MAX_FILE_BYTES-1000 + MAX_FILE_BYTES-len(document))
        self.assertEqual(len(document), MAX_FILE_BYTES)
        upload, _ = self.receive(document, 'large.pdf', 'article')
        self.assertIn('Hello local PDF', self.service.process(USER, upload, {'workflow': 'article'})['text'])
        archive = io.BytesIO(apkg())
        name = 'unused-media'
        overhead = 76 + 2*len(name)
        with zipfile.ZipFile(archive, 'a', compression=zipfile.ZIP_STORED) as output:
            output.writestr(name, b' '*(MAX_FILE_BYTES-len(archive.getvalue())-overhead))
        self.assertEqual(len(archive.getvalue()), MAX_FILE_BYTES)
        upload, _ = self.receive(archive.getvalue(), 'large.apkg')
        self.assertIn('grüßen', self.service.process(USER, upload, {'workflow': 'file'})['rows'][0])

    def test_processing_expiry_and_changed_settings(self):
        upload, key = self.receive(b'word\nhello\n')
        with patch.object(self.service, 'clock', return_value=time.time()+4000), self.assertRaises(UploadError) as error:
            self.service.process(USER, upload, {'workflow': 'file'})
        self.assertEqual(error.exception.status, 410)
        self.service.process(USER, upload, {'workflow': 'file'})
        with self.assertRaises(UploadError) as error:
            self.service.process(USER, upload, {'workflow': 'file', 'has_header': False})
        self.assertEqual(error.exception.status, 409)

    def test_gcs_generation_guards_and_mime_validation(self):
        client = MagicMock()
        bucket = client.get_bucket.return_value
        bucket.iam_configuration.public_access_prevention = 'enforced'
        bucket.iam_configuration.uniform_bucket_level_access_enabled = True
        store = GCSUploadStore('fixture', 'signer@example.test', client)
        blob = bucket.get_blob.return_value
        blob.metadata = {'voca': json.dumps({'mime': 'text/csv'})}
        blob.content_type = 'application/pdf'
        with self.assertRaises(UploadError): store.describe('key')
        store.download('key', Path(self.tmp.name)/'file', {'generation': 23})
        bucket.blob.assert_called_with('key', generation=23)
        bucket.blob.return_value.download_to_filename.assert_called_once_with(str(Path(self.tmp.name)/'file'), if_generation_match=23, checksum='auto')
        blob.metageneration = 9
        blob.metadata = {'voca': '{}', 'processing': '123'}
        store.release('key', 9)
        self.assertIsNone(blob.metadata['processing'])
        blob.patch.assert_called_once_with(if_metageneration_match=9)

    def test_explicit_ai_duplicate_processing_uses_one_receipt(self):
        upload, key = self.receive(pdf(image=True), 'scan.pdf', 'article')
        self.service.process(USER, upload, {'workflow': 'article'})
        def extract(command, **kwargs):
            Path(command[-1]).write_text(json.dumps({'text': 'Explicit synthetic extraction.'}))
            return SimpleNamespace(returncode=0)
        with patch('services.upload_service.subprocess.run', side_effect=extract) as ai:
            options = {'workflow': 'article', 'method': 'ai', 'consent_ai': True}
            result = self.service.process(USER, upload, options)
            self.assertEqual(self.service.process(USER, upload, options), result)
            ai.assert_called_once()
            self.assertFalse(self.store.path(key).exists())

    def test_pdf_page_timeout_and_text_budgets(self):
        from services.pdf_extract import extract_pdf
        import subprocess
        path = Path(self.tmp.name)/'input.pdf'; path.write_bytes(pdf())
        with patch('services.pdf_extract.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='Pages: 201\n')), self.assertRaisesRegex(UploadError, '200 pages'):
            extract_pdf(path)
        with patch('services.pdf_extract.subprocess.run', side_effect=subprocess.TimeoutExpired('pdfinfo', 15)), self.assertRaisesRegex(UploadError, 'timed out'):
            extract_pdf(path)
        def oversized(command, **kwargs):
            if command[0] == 'pdfinfo': return SimpleNamespace(returncode=0, stdout='Pages: 1\n')
            Path(command[-1]).write_text('a'*100001)
            return SimpleNamespace(returncode=0)
        with patch('services.pdf_extract.subprocess.run', side_effect=oversized), self.assertRaisesRegex(UploadError, '100,000'):
            extract_pdf(path)

    def test_signed_policy_exact_size_private_bucket_and_no_app_credentials(self):
        client = MagicMock()
        client.get_bucket.return_value.iam_configuration.public_access_prevention = 'enforced'
        client.get_bucket.return_value.iam_configuration.uniform_bucket_level_access_enabled = True
        client.get_bucket.return_value.name = 'fixture-private-bucket'
        client._credentials.valid = True
        client._credentials.token = 'public-test-token'
        client.generate_signed_post_policy_v4.return_value = {'url': 'https://storage.googleapis.com/fixture', 'fields': {}}
        service = UploadService(GCSUploadStore('fixture-private-bucket', 'signer@example.test', client))
        ticket = service.initialize(USER, {'filename': 'large.apkg', 'size': MAX_FILE_BYTES, 'workflow': 'file'})
        self.assertEqual(ticket['transport'], 'gcs-post')
        call = client.generate_signed_post_policy_v4.call_args
        self.assertIn(['content-length-range', MAX_FILE_BYTES, MAX_FILE_BYTES], call.kwargs['conditions'])
        self.assertIn('voca/tmp/', call.args[1])
        client.get_bucket.return_value.iam_configuration.public_access_prevention = 'inherited'
        with self.assertRaises(UploadError): GCSUploadStore('bucket', 'signer', client)

    def test_local_fallback_is_forbidden_on_cloud_run(self):
        with patch.dict('os.environ', {'K_SERVICE': 'fixture'}), self.assertRaises(UploadError): LocalUploadStore(self.tmp.name)


class UploadAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = UploadService(LocalUploadStore(self.tmp.name))
        app = Flask(__name__)
        @app.before_request
        def auth():
            if request.method != 'OPTIONS' and not request.headers.get('X-Test-User'): abort(401)
            g.user_id = request.headers.get('X-Test-User')
        app.register_blueprint(uploads_bp, url_prefix='/api/uploads')
        self.client = app.test_client()

    def tearDown(self): self.tmp.cleanup()

    def test_unexpected_errors_log_safe_diagnostics_without_signed_data(self):
        from google.auth.exceptions import TransportError
        error = TransportError('Error calling IAM API: {"error":{"code":403,"status":"PERMISSION_DENIED",'
            '"details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}} '
            'https://storage.example.test/private?X-Goog-Signature=PRIVATE_SENTINEL access_token=TOKEN_SENTINEL')
        for method, path in [('post', '/api/uploads'), ('post', '/api/uploads/'+'a'*32+'.txt/process'),
                             ('delete', '/api/uploads/'+'a'*32+'.txt')]:
            with self.subTest(path=path), patch('routes.uploads.get_upload_service', side_effect=error), \
                 self.assertLogs(self.client.application.logger, level='ERROR') as captured:
                result = getattr(self.client, method)(path, json={'filename':'PRIVATE_FILENAME'}, headers={'X-Test-User':USER})
            self.assertEqual(result.status_code, 503)
            diagnostic = json.loads(captured.records[0].getMessage())
            self.assertEqual(diagnostic['error_id'], result.json['error_id'])
            self.assertEqual(diagnostic['exception_type'], 'TransportError')
            self.assertEqual(diagnostic['upstream_status'], 403)
            self.assertIn('ACCESS_TOKEN_SCOPE_INSUFFICIENT', diagnostic['reasons'])
            for secret in ['PRIVATE_SENTINEL', 'TOKEN_SENTINEL', 'PRIVATE_FILENAME', 'storage.example.test']:
                self.assertNotIn(secret, captured.output[0] + result.text)

    def test_auth_initialize_content_finalize_and_failed_finalize(self):
        with patch('routes.uploads.get_upload_service', return_value=self.service):
            self.assertEqual(self.client.post('/api/uploads', json={}).status_code, 401)
            headers = {'X-Test-User': USER}
            data = b'word,translation\nhello,hi\n'
            ticket = self.client.post('/api/uploads', json={'filename': 'x.csv', 'size': len(data), 'workflow': 'file'}, headers=headers).json
            base = '/api/uploads/'+ticket['upload_id']
            self.assertEqual(self.client.post(base+'/process', json={'workflow': 'file'}, headers=headers).status_code, 413)
            self.assertEqual(self.client.put(base+'/content', data=data, content_type='text/csv', headers=headers).status_code, 200)
            self.assertEqual(self.client.post(base+'/process', json={'workflow': 'file'}, headers={'X-Test-User': OTHER}).status_code, 404)
            self.assertEqual(self.client.post(base+'/process', json={'workflow': 'file'}, headers=headers).status_code, 200)
            self.assertEqual(self.client.delete(base, headers=headers).status_code, 200)
