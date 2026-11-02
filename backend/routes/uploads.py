import json
from flask import Blueprint, Response, g, request
from werkzeug.exceptions import RequestEntityTooLarge
from services.upload_policy import MAX_FILE_BYTES, UploadError
from services.upload_service import get_upload_service
from services.upload_store import LocalUploadStore

uploads_bp = Blueprint('uploads', __name__)


def response(value, status=200):
    return Response(json.dumps(value, ensure_ascii=False), status=status, mimetype='application/json')


@uploads_bp.before_request
def limits():
    if request.method == 'OPTIONS':
        return
    request.max_content_length = MAX_FILE_BYTES if request.path.endswith('/content') else 16 * 1024


@uploads_bp.errorhandler(UploadError)
def invalid(error):
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
    except Exception:
        return response({'message': 'Secure upload authorization is unavailable. Retry later.'}, 503)


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
    except Exception:
        return response({'message': 'Object verification or processing failed. Retry; no import was committed.'}, 503)


@uploads_bp.delete('/<upload_id>')
def cancel(upload_id):
    try:
        get_upload_service().cancel(g.user_id, upload_id)
        return response({'cancelled': True})
    except UploadError:
        raise
    except Exception:
        return response({'message': 'Cleanup could not be confirmed. Temporary objects will expire.'}, 503)
