import json
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'upload_policy.json').read_text())
MAX_FILE_BYTES = POLICY['max_file_bytes']


class UploadError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def validate_upload(data):
    if not isinstance(data, dict):
        raise UploadError('Expected upload details.')
    filename, size, workflow = data.get('filename'), data.get('size'), data.get('workflow')
    if not isinstance(filename, str) or len(filename) > 255 or '/' in filename or '\\' in filename:
        raise UploadError('Invalid filename.')
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise UploadError('Choose a non-empty file.')
    if size > MAX_FILE_BYTES:
        raise UploadError('File exceeds 50 MiB (52,428,800 bytes).', 413)
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    allowed = POLICY.get(f'{workflow}_extensions', []) if workflow in ('file', 'article') else []
    if extension not in allowed:
        raise UploadError('Unsupported format for this import workflow.')
    mime = {'csv': 'text/csv', 'tsv': 'text/tab-separated-values', 'txt': 'text/plain',
            'apkg': 'application/octet-stream', 'pdf': 'application/pdf', 'png': 'image/png',
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}[extension]
    return {'filename': filename, 'size': size, 'workflow': workflow, 'extension': extension, 'mime': mime}
