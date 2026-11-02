import hashlib
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys
import tempfile
from threading import BoundedSemaphore
import time
import uuid

from services.upload_policy import POLICY, MAX_FILE_BYTES, UploadError, validate_upload
from services.upload_store import LocalUploadStore, GCSUploadStore

_processing = BoundedSemaphore(1)


def _parser_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    resource.setrlimit(resource.RLIMIT_FSIZE, (POLICY['max_result_bytes'] + 1024, POLICY['max_result_bytes'] + 1024))
    if sys.platform == 'linux':
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))


def parse_vocabulary(path, filename, settings):
    with tempfile.TemporaryDirectory(prefix='voca-parse-') as directory:
        output = Path(directory) / 'preview.json'
        try:
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/parse_upload.py'),
                str(path), str(output), filename, json.dumps(settings)], capture_output=True, timeout=60,
                preexec_fn=_parser_limits)
        except subprocess.TimeoutExpired as error:
            raise UploadError('Parsing exceeded 60 seconds. Split or simplify the file.', 422) from error
        if result.returncode:
            if result.returncode == 2:
                raise UploadError(json.loads(result.stdout)['message'], 422)
            raise UploadError('File exceeds the safe parsing memory/CPU budget. Split or simplify it.', 422)
        return json.loads(output.read_text(encoding='utf-8'))


class UploadService:
    def __init__(self, store, clock=time.time):
        self.store, self.clock = store, clock

    def key(self, user_id, upload_id):
        if not isinstance(upload_id, str) or not re.fullmatch(r'[0-9a-f]{32}\.(csv|tsv|txt|md|markdown|apkg|pdf|png|jpe?g)', upload_id):
            raise UploadError('Invalid upload identifier.')
        owner = hashlib.sha256(str(user_id).encode()).hexdigest()[:32]
        return f'voca/tmp/{owner}/{upload_id}', owner

    def initialize(self, user_id, data):
        values = validate_upload(data)
        upload_id = uuid.uuid4().hex + '.' + values['extension']
        key, owner = self.key(user_id, upload_id)
        now = int(self.clock())
        claims = {**values, 'owner': owner, 'object': key, 'upload_expires': now + POLICY['authorization_seconds'],
                  'expires': now + POLICY['processing_seconds']}
        return {**self.store.authorize(key, claims), 'upload_id': upload_id,
                'expires_at': claims['upload_expires'], 'max_file_bytes': MAX_FILE_BYTES}

    def cancel(self, user_id, upload_id):
        key, _ = self.key(user_id, upload_id)
        self.store.delete(key)

    def process(self, user_id, upload_id, data):
        key, owner = self.key(user_id, upload_id)
        if not isinstance(data, dict) or data.get('workflow') not in ('file', 'article'):
            raise UploadError('Choose the import workflow.')
        method = data.get('method', 'local')
        if method not in ('local', 'ai') or (method == 'ai' and (data['workflow'] != 'article' or data.get('consent_ai') is not True)):
            raise UploadError('AI extraction requires a separate explicit action.')
        settings = {k: data.get(k) for k in ('delimiter', 'has_header')}
        if settings['delimiter'] is not None and settings['delimiter'] not in (',', '\t', ';', '|', ' ', ':'):
            raise UploadError('Invalid delimiter.')
        if settings['has_header'] is not None and type(settings['has_header']) is not bool:
            raise UploadError('Invalid header setting.')
        recipe = hashlib.sha256(json.dumps([data['workflow'], settings], sort_keys=True).encode()).hexdigest()
        receipt = self.store.receipt(key, method)
        if receipt:
            if receipt['owner'] != owner or receipt['recipe'] != recipe:
                raise UploadError('Upload settings changed. Upload the file again.', 409)
            if self.clock() > receipt['expires']:
                raise UploadError('Temporary upload expired. Upload again.', 410)
            return receipt['result']
        metadata = self.store.describe(key)
        if metadata.get('owner') != owner or metadata.get('object') != key or metadata.get('workflow') != data['workflow']:
            raise UploadError('Upload ownership or workflow does not match.', 403)
        if self.clock() > metadata.get('expires', 0):
            raise UploadError('Temporary upload expired. Upload again.', 410)
        if not 1 <= metadata.get('actual_size', 0) <= MAX_FILE_BYTES:
            raise UploadError('Stored object is empty or exceeds 50 MiB.', 413)
        if metadata['actual_size'] != metadata.get('size'):
            raise UploadError('Stored object size does not match the upload authorization.')
        if not _processing.acquire(blocking=False):
            raise UploadError('Another document is being processed. Retry shortly.', 429)
        claimed = False
        try:
            claim = self.store.claim(key, metadata)
            claimed = True
            with tempfile.TemporaryDirectory(prefix='voca-input-') as directory:
                path = Path(directory) / ('input.' + metadata['extension'])
                self.store.download(key, path, metadata)
                if path.stat().st_size != metadata['actual_size']:
                    raise UploadError('Downloaded object size changed. Retry.', 409)
                with path.open('rb') as stream:
                    prefix = stream.read(16)
                extension = metadata['extension']
                if extension == 'apkg' and not prefix.startswith(b'PK\x03\x04'):
                    raise UploadError('The file is not a valid APKG archive.')
                if extension == 'pdf' and not prefix.startswith(b'%PDF-'):
                    raise UploadError('The file is not a PDF document.')
                if extension == 'png' and not prefix.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise UploadError('The file is not a PNG image.')
                if extension in ('jpg', 'jpeg') and not prefix.startswith(b'\xff\xd8\xff'):
                    raise UploadError('The file is not a JPEG image.')
                if extension in ('csv', 'tsv', 'txt', 'md', 'markdown') and prefix.startswith((b'%PDF-', b'PK\x03\x04', b'\x89PNG', b'\xff\xd8\xff')):
                    raise UploadError('File content does not match a text document.')
                if data['workflow'] == 'file':
                    result = parse_vocabulary(path, metadata['filename'], settings)
                elif method == 'local':
                    if extension == 'pdf':
                        from services.pdf_extract import extract_pdf
                        result = extract_pdf(path)
                    elif extension in ('txt', 'md', 'markdown'):
                        from services.pdf_extract import MAX_TEXT
                        try:
                            with path.open(encoding='utf-8-sig') as source:
                                text = source.read(MAX_TEXT + 1)
                        except UnicodeError as error:
                            raise UploadError('Save the text document as UTF-8 (BOM is supported).', 422) from error
                        if len(text) > MAX_TEXT:
                            raise UploadError('Article exceeds 100,000 characters. Split the document.', 422)
                        if not text.strip() or any(ord(char) < 32 and char not in '\t\n\r' for char in text):
                            raise UploadError('The document is empty or contains unsupported binary/control characters.', 422)
                        result = {'text': text.strip(), 'needs_ocr': False, 'method': 'local',
                                  'warnings': ['Markdown formatting is kept as editable plain text.'] if extension != 'txt' else []}
                    else:
                        result = {'text': '', 'needs_ocr': True, 'method': 'local', 'warnings': ['Image extraction requires an explicit AI action.']}
                    result['ai_allowed'] = result['needs_ocr'] and metadata['size'] <= 20 * 1024 * 1024 and result.get('pages', 1) <= 100
                else:
                    previous = self.store.receipt(key, 'local')
                    if not previous or not previous['result'].get('needs_ocr') or previous['result'].get('pages', 1) > 100:
                        raise UploadError('Run local extraction first. AI supports scanned/image documents up to 100 pages.', 422)
                    if metadata['size'] > 20 * 1024 * 1024:
                        raise UploadError('Explicit AI extraction supports at most 20 MiB. Split or OCR the document locally.', 422)
                    output = Path(directory) / 'ai.json'
                    try:
                        process = subprocess.run([sys.executable,
                            str(Path(__file__).resolve().parents[1] / 'scripts/extract_ai_upload.py'), str(path),
                            metadata['mime'], str(output)], capture_output=True, timeout=120, preexec_fn=_parser_limits)
                    except subprocess.TimeoutExpired as error:
                        raise UploadError('AI extraction timed out. Retry explicitly or OCR the document locally.', 422) from error
                    if process.returncode or not output.exists():
                        raise UploadError('AI extraction is unavailable or exceeded provider/resource limits. Retry explicitly or use local OCR.', 502)
                    result = {**json.loads(output.read_text()), 'method': 'ai', 'needs_ocr': False}
                receipt = {'owner': owner, 'expires': metadata['expires'], 'recipe': recipe, 'result': result}
                self.store.save_receipt(key, method, receipt)
                if not result.get('needs_ocr'):
                    self.store.delete_input(key, metadata)
                return result
        finally:
            if claimed:
                self.store.release(key, claim)
            _processing.release()


_service = None


def get_upload_service():
    global _service
    if _service is None:
        provider = os.getenv('UPLOAD_PROVIDER', 'gcs' if os.getenv('K_SERVICE') else 'local')
        if provider == 'gcs':
            store = GCSUploadStore(os.getenv('UPLOAD_BUCKET'), os.getenv('UPLOAD_SIGNER_EMAIL'))
        elif provider == 'local':
            store = LocalUploadStore()
        else:
            raise UploadError('Unsupported upload storage configuration.', 503)
        _service = UploadService(store)
    return _service
