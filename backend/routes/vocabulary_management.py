"""Authenticated self-service management; never accepts a target account ID."""
import json
from werkzeug.exceptions import HTTPException
from flask import Blueprint, g, jsonify, request
from services.supabase_client import get_supabase
from services.vocabulary_management import (BackupStore, ManagementError, batch_delete, prepare_clear, clear_batch, restore_backup)

management_bp = Blueprint('vocabulary_management', __name__)


@management_bp.before_request
def bounded_request():
    if request.method == 'OPTIONS':
        return
    request.max_content_length = 16 * 1024
    if not getattr(g, 'user_id', None):
        return jsonify({'message': 'Authentication required.'}), 401


@management_bp.errorhandler(ManagementError)
def invalid(error):
    return jsonify({'message': str(error)}), error.status


@management_bp.errorhandler(Exception)
def unavailable(error):
    if isinstance(error, HTTPException):
        return jsonify({'message': 'Invalid vocabulary management request.'}), error.code
    # No exception text, IDs, request data or private vocabulary in logs.
    print(json.dumps({'event': 'vocabulary_management_failure', 'type': type(error).__name__, 'upstream_status': getattr(getattr(error, 'response', None), 'status_code', None)}), flush=True)
    return jsonify({'message': 'Vocabulary operation could not be verified. Refresh and retry; your private backup is retained.'}), 503


@management_bp.post('/batch-delete')
def delete_batch():
    data = request.get_json(silent=True) or {}
    result = batch_delete(get_supabase(), g.user_id, data.get('ids'), BackupStore())
    return jsonify(result)


@management_bp.post('/clear/prepare')
def prepare():
    result = prepare_clear(get_supabase(), g.user_id, BackupStore())
    print(json.dumps({'event': 'vocabulary_backup_verified', **result}), flush=True)
    return jsonify(result), 201


@management_bp.post('/clear')
def clear():
    data = request.get_json(silent=True) or {}
    result = clear_batch(get_supabase(), g.user_id, data.get('backup_id'), data.get('confirmation'), BackupStore())
    print(json.dumps({'event': 'vocabulary_clear_result', **result}), flush=True)
    return jsonify(result)


@management_bp.get('/backups/<operation>')
def download(operation):
    response = jsonify(BackupStore().get(g.user_id, operation))
    response.headers['Content-Disposition'] = 'attachment; filename="voca-vocabulary-backup.json"'
    response.headers['Cache-Control'] = 'no-store'
    return response


@management_bp.post('/backups/<operation>/restore')
def restore(operation):
    data = request.get_json(silent=True) or {}
    result = restore_backup(get_supabase(), g.user_id, operation, data.get('confirmation'), BackupStore())
    return jsonify(result)
