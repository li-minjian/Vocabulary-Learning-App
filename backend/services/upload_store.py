"""Private temporary objects. GCS is production; filesystem is loopback development only."""
import json
import hashlib
import os
from pathlib import Path
import tempfile
import time
from services.upload_policy import MAX_FILE_BYTES, UploadError


class LocalUploadStore:
    transport = 'local-put'

    def __init__(self, directory=None):
        if os.getenv('K_SERVICE'):
            raise UploadError('Local upload transport is disabled on Cloud Run.', 503)
        self.root = Path(directory or tempfile.mkdtemp(prefix='voca-uploads-')).resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    def path(self, key):
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise UploadError('Invalid upload object.')
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        return path

    def authorize(self, key, claims):
        self.path(key + '.meta').write_text(json.dumps(claims))
        return {'transport': self.transport, 'url': f'/api/uploads/{key.rsplit("/", 1)[-1]}/content',
                'fields': {}, 'content_type': claims['mime']}

    def describe(self, key):
        meta = self.path(key + '.meta')
        if not meta.is_file():
            raise UploadError('Upload not found.', 404)
        claims = json.loads(meta.read_text())
        path = self.path(key)
        return {**claims, 'actual_size': path.stat().st_size if path.exists() else 0,
                'generation': self.generation(path) if path.exists() else None}

    @staticmethod
    def generation(path):
        # Temp filesystem timestamp precision varies; verify the actual bytes.
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        return digest.hexdigest()

    def receive(self, key, stream, mime):
        claims = self.describe(key)
        if time.time() > claims['upload_expires']:
            raise UploadError('Upload authorization expired. Retry the upload.', 410)
        if mime != claims['mime']:
            raise UploadError('Upload content type does not match authorization.')
        path = self.path(key)
        if path.exists():
            raise UploadError('File is already uploaded. Retry processing instead.', 409)
        staging = path.with_suffix(path.suffix + '.partial')
        owned = False
        try:
            with staging.open('xb') as output:
                owned = True
                size = 0
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_FILE_BYTES or size > claims['size']:
                        raise UploadError('File exceeds its authorized size or 50 MiB.', 413)
                    output.write(chunk)
            if size != claims['size']:
                raise UploadError('Upload was interrupted or its byte size does not match.')
            staging.replace(path)
        except FileExistsError as error:
            raise UploadError('This upload is already in progress.', 409) from error
        finally:
            if owned:
                staging.unlink(missing_ok=True)

    def receipt(self, key, method):
        path = self.path(key + f'.{method}.result')
        return json.loads(path.read_text()) if path.is_file() else None

    def save_receipt(self, key, method, receipt):
        self.path(key + f'.{method}.result').write_text(json.dumps(receipt, ensure_ascii=False))

    def claim(self, key, metadata):
        lock = self.path(key + '.lock')
        if lock.exists() and time.time() - lock.stat().st_mtime > 300:
            lock.unlink(missing_ok=True)
        try:
            lock.touch(exist_ok=False)
        except FileExistsError as error:
            raise UploadError('This file is being processed. Retry shortly.', 409) from error
        return None

    def release(self, key, claim):
        self.path(key + '.lock').unlink(missing_ok=True)

    def download(self, key, path, metadata):
        source = self.path(key)
        if not source.is_file():
            raise UploadError('Upload changed during verification. Retry.', 409)
        import shutil
        shutil.copyfile(source, path)
        if self.generation(path) != metadata['generation']:
            raise UploadError('Upload changed during verification. Retry.', 409)

    def delete_input(self, key, metadata):
        self.path(key).unlink(missing_ok=True)

    def delete(self, key):
        if self.path(key + '.lock').exists():
            raise UploadError('Processing is in progress; temporary files will expire.', 409)
        for suffix in ('', '.meta', '.local.result', '.ai.result', '.partial'):
            self.path(key + suffix).unlink(missing_ok=True)


class GCSUploadStore:
    transport = 'gcs-post'

    def __init__(self, bucket, signer_email, client=None):
        if not bucket or not signer_email:
            raise UploadError('Secure cloud uploads are not configured. Contact the operator.', 503)
        from google.cloud import storage
        self.client = client or storage.Client()
        self.bucket = self.client.get_bucket(bucket)
        policy = self.bucket.iam_configuration
        if policy.public_access_prevention != 'enforced' or not policy.uniform_bucket_level_access_enabled:
            raise UploadError('Upload bucket must enforce private uniform access. Contact the operator.', 503)
        self.signer_email = signer_email

    def authorize(self, key, claims):
        import google.auth
        from google.auth.transport.requests import Request
        from datetime import timedelta
        credentials = self.client._credentials
        if not credentials.valid:
            credentials.refresh(Request())
        fields = {'Content-Type': claims['mime'], 'x-goog-meta-voca': json.dumps(claims, separators=(',', ':'))}
        conditions = [{'Content-Type': claims['mime']}, {'x-goog-meta-voca': fields['x-goog-meta-voca']},
                      ['content-length-range', claims['size'], claims['size']]]
        policy = self.client.generate_signed_post_policy_v4(self.bucket.name, key,
            expiration=timedelta(seconds=600), conditions=conditions, fields=fields,
            service_account_email=self.signer_email, access_token=credentials.token)
        return {'transport': self.transport, **policy, 'content_type': claims['mime']}

    def describe(self, key):
        blob = self.bucket.get_blob(key)
        if blob is None:
            raise UploadError('Upload not found or not yet complete.', 404)
        try:
            claims = json.loads((blob.metadata or {})['voca'])
        except (ValueError, KeyError, TypeError) as error:
            raise UploadError('Uploaded object has invalid authorization metadata.') from error
        if blob.content_type != claims.get('mime'):
            raise UploadError('Stored content type does not match authorization.')
        return {**claims, 'actual_size': int(blob.size), 'generation': int(blob.generation),
                'metageneration': int(blob.metageneration), 'processing': (blob.metadata or {}).get('processing')}

    def receipt(self, key, method):
        blob = self.bucket.get_blob(key + f'.{method}.result.json')
        return json.loads(blob.download_as_bytes(if_generation_match=blob.generation)) if blob else None

    def save_receipt(self, key, method, receipt):
        from google.api_core.exceptions import PreconditionFailed
        try:
            self.bucket.blob(key + f'.{method}.result.json').upload_from_string(
                json.dumps(receipt, ensure_ascii=False), content_type='application/json', if_generation_match=0)
        except PreconditionFailed:
            pass  # A confirmed receipt from the same immutable upload already exists.

    def claim(self, key, metadata):
        from google.api_core.exceptions import PreconditionFailed
        if metadata.get('processing') and time.time() - float(metadata['processing']) < 300:
            raise UploadError('This file is being processed. Retry shortly.', 409)
        blob = self.bucket.blob(key, generation=metadata['generation'])
        blob.metadata = {'voca': json.dumps({k: v for k, v in metadata.items() if k not in
                         ('actual_size', 'generation', 'metageneration', 'processing')}), 'processing': str(time.time())}
        try:
            blob.patch(if_metageneration_match=metadata['metageneration'])
            return blob.metageneration
        except PreconditionFailed as error:
            raise UploadError('Upload changed or is already being processed. Retry.', 409) from error

    def release(self, key, claim):
        from google.api_core.exceptions import NotFound, PreconditionFailed
        try:
            blob = self.bucket.get_blob(key)
            if blob and blob.metageneration == claim:
                # GCS PATCH merges metadata maps; omission does not delete a key.
                blob.metadata = {'voca': blob.metadata['voca'], 'processing': None}
                blob.patch(if_metageneration_match=claim)
        except (NotFound, PreconditionFailed):
            pass

    def download(self, key, path, metadata):
        self.bucket.blob(key, generation=metadata['generation']).download_to_filename(
            str(path), if_generation_match=metadata['generation'], checksum='auto')

    def delete_input(self, key, metadata):
        from google.api_core.exceptions import NotFound, PreconditionFailed
        try:
            self.bucket.blob(key).delete(if_generation_match=metadata['generation'])
        except (NotFound, PreconditionFailed):
            pass  # Do not delete a substituted/new generation.

    def delete(self, key):
        from google.api_core.exceptions import NotFound
        blob = self.bucket.get_blob(key)
        if blob:
            metadata = self.describe(key)
            if metadata.get('processing') and time.time() - float(metadata['processing']) < 300:
                raise UploadError('Processing is in progress; temporary files will expire.', 409)
            blob.delete(if_metageneration_match=metadata['metageneration'])
        for method in ('local', 'ai'):
            try:
                self.bucket.blob(key + f'.{method}.result.json').delete()
            except NotFound:
                pass
