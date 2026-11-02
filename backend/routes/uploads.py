import json
from pathlib import Path
import re
import traceback
import uuid
from flask import Blueprint, Response, current_app, g, request
from werkzeug.exceptions import RequestEntityTooLarge
from services.upload_policy import MAX_FILE_BYTES, UploadError
from services.upload_service import get_upload_service
from services.upload_store import LocalUploadStore

uploads_bp = Blueprint('uploads', __name__)


def log_failure(operation, error):
    """Log structural diagnostics only: no exception text, locals or request data."""
    error_id = uuid.uuid4().hex
    message = str(error)  # Inspect known codes in memory; never emit this string.
    reasons = [reason for reason in ('ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'IAM_PERMISSION_DENIED',
               'PERMISSION_DENIED', 'SERVICE_DISABLED', 'RATE_LIMIT_EXCEEDED') if reason in message]
    status = getattr(error, 'code', None)
    if not isinstance(status, int):
        match = re.search(r'"code"\s*:\s*(\d{3})', message)
        status = int(match[1]) if match else None
    current_app.logger.error(json.dumps({
        'event': 'upload_failure', 'error_id': error_id, 'operation': operation,
        'exception_type': type(error).__name__, 'exception_module': type(error).__module__,
        'upstream_status': status, 'reasons': reasons,
        'frames': [{'file': Path(frame.filename).name, 'function': frame.name, 'line': frame.lineno}
                   for frame in traceback.extract_tb(error.__traceback__)[-8:]],
    }))
    return error_id


def response(value, status=200):
    return Response(json.dumps(value, ensure_ascii=False), status=status, mimetype='application/json')


@uploads_bp.before_request
def limits():
    if request.method == 'OPTIONS':
        return
    request.max_content_length = MAX_FILE_BYTES if request.path.endswith('/content') else 16 * 1024


@uploads_bp.errorhandler(UploadError)
def invalid(error):
    if error.status >= 500:
        log_failure(request.endpoint, error)
    return response({'message': str(error)}, error.status)


@uploads_bp.errorhandler(RequestEntityTooLarge)
def too_large(error):
    return response({'message': 'Request exceeds its size limit (file maximum 50 MiB).'}, 413)


@uploads_bp.post('')
def initialize():
    try:
        return response(get_upload_service().initialize(g.user_id, request.get_json(silent=True)), 201)
    except UploadError:
        raise
    except Exception as error:
        error_id = log_failure('initialize', error)
        return response({'message': 'Secure upload authorization is unavailable. Retry later.', 'error_id': error_id}, 503)


@uploads_bp.put('/<upload_id>/content')
def local_content(upload_id):
    service = get_upload_service()
    if not isinstance(service.store, LocalUploadStore):
        raise UploadError('Production uploads must go directly to private object storage.', 404)
    key, _ = service.key(g.user_id, upload_id)
    service.store.receive(key, request.stream, request.mimetype)
    return response({'uploaded': True})


@uploads_bp.post('/<upload_id>/process')
def process(upload_id):
    try:
        return response(get_upload_service().process(g.user_id, upload_id, request.get_json(silent=True)))
    except UploadError:
        raise
    except Exception as error:
        error_id = log_failure('process', error)
        return response({'message': 'Object verification or processing failed. Retry; no import was committed.', 'error_id': error_id}, 503)


@uploads_bp.delete('/<upload_id>')
def cancel(upload_id):
    try:
        get_upload_service().cancel(g.user_id, upload_id)
        return response({'cancelled': True})
    except UploadError:
        raise
    except Exception as error:
        error_id = log_failure('cancel', error)
        return response({'message': 'Cleanup could not be confirmed. Temporary objects will expire.', 'error_id': error_id}, 503)
