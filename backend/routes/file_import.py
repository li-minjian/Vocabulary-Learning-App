"""Independent structured imports. No article import or AI service dependency."""
from flask import Blueprint, g, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge
from services.file_parser import ImportValidationError, MAX_FILE_BYTES, parse_file
from services.file_import_service import commit_import, preview_import
from services.supabase_client import get_supabase
from services.upload_policy import POLICY

file_import_bp = Blueprint('file_import', __name__)


@file_import_bp.before_request
def validate_request():
    if request.method == 'OPTIONS':
        return
    if not getattr(g, 'user_id', None):
        return jsonify({'message': 'Authentication required.'}), 401
    # Bound request bodies as well as decoded file sizes, including chunked requests.
    request.max_content_length = POLICY['max_control_bytes']


@file_import_bp.errorhandler(ImportValidationError)
def invalid(error):
    return jsonify({'message': str(error)}), 400


@file_import_bp.errorhandler(RequestEntityTooLarge)
def too_large(error):
    return jsonify({'message': 'Import control request exceeds 12 MiB. Upload files up to 50 MiB using the secure upload flow.'}), 413


@file_import_bp.post('/parse')
def parse():
    if request.mimetype == 'multipart/form-data':
        uploaded = request.files.get('file')
        if not uploaded:
            raise ImportValidationError('Choose a vocabulary file.')
        data = uploaded.read(MAX_FILE_BYTES + 1)
        filename = uploaded.filename or 'vocabulary.csv'
        delimiter = request.form.get('delimiter') or None
        header = request.form.get('has_header', 'auto')
        if header not in ('auto', 'true', 'false'):
            raise ImportValidationError('has_header must be auto, true or false.')
        has_header = None if header == 'auto' else header == 'true'
    else:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not isinstance(payload.get('text'), str):
            raise ImportValidationError('Provide a file or UTF-8 text.')
        data = payload['text'].encode('utf-8')
        filename = payload.get('filename', 'vocabulary.txt')
        delimiter = payload.get('delimiter') or None
        has_header = payload.get('has_header')
        if has_header not in (None, True, False):
            raise ImportValidationError('has_header must be a boolean.')
    if not isinstance(filename, str) or not isinstance(delimiter, (str, type(None))):
        raise ImportValidationError('Invalid filename or delimiter.')
    return jsonify(parse_file(data, filename, delimiter, has_header))


@file_import_bp.post('/preview')
def preview():
    try:
        return jsonify(preview_import(get_supabase(), g.user_id, request.get_json(silent=True)))
    except ImportValidationError:
        raise
    except Exception:
        return jsonify({'message': 'Unable to check your vocabulary or collection. Retry when the backend is available.'}), 503


@file_import_bp.post('/commit')
def commit():
    try:
        result = commit_import(get_supabase(), g.user_id, request.get_json(silent=True))
        return jsonify(result)
    except ImportValidationError:
        raise
    except Exception:
        return jsonify({'message': 'Import could not be completed. Retry with the same import ID; existing words will be preserved.'}), 503
