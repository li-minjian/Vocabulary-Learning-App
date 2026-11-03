"""Authenticated exercise domain; the existing JWT hook and RLS remain authoritative."""
from flask import Blueprint, g, jsonify, request, current_app
from services.supabase_client import get_supabase
from services import exercise_service as service
from services.file_parser import ImportValidationError
exercises_bp = Blueprint('exercises', __name__)

@exercises_bp.before_request
def boundary():
    if request.method == 'OPTIONS':
        return
    if not getattr(g, 'user_id', None):
        return (jsonify({'message': 'Authentication required.'}), 401)
    request.max_content_length = 12 * 1024 * 1024

@exercises_bp.errorhandler(service.ExerciseError)
@exercises_bp.errorhandler(ImportValidationError)
def invalid(error):
    return (jsonify({'message': str(error)}), getattr(error, 'status', 400))

@exercises_bp.errorhandler(Exception)
def unavailable(error):
    from werkzeug.exceptions import HTTPException
    if isinstance(error, HTTPException):
        return (jsonify({'message': error.description}), error.code)
    current_app.logger.error('exercise_operation_failed operation=%s error_class=%s', request.endpoint, type(error).__name__)
    return (jsonify({'message': 'Exercise operation could not be confirmed. Reload or retry the same operation.'}), 503)

def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise service.ExerciseError('Provide a JSON object.')
    return data

def integer(name, default, maximum):
    try:
        value = int(request.args.get(name, default))
    except (ValueError, TypeError):
        raise service.ExerciseError('Invalid pagination.')
    if not 0 <= value <= maximum:
        raise service.ExerciseError('Pagination exceeds the supported limit.')
    return value

@exercises_bp.get('/sets')
def sets():
    return jsonify({'items': service.list_sets(get_supabase(), g.user_id)})

@exercises_bp.post('/sets')
def create():
    return (jsonify(service.create_set(get_supabase(), g.user_id, body())), 201)

@exercises_bp.get('/sets/<id>')
def detail(id):
    return jsonify(service.set_detail(get_supabase(), g.user_id, service.uid(id), integer('offset', 0, 10000), max(1, integer('limit', 50, 200)), {key: request.args.get(key, '') for key in ('category', 'unit', 'source_deck')}))

@exercises_bp.patch('/sets/<id>')
def rename(id):
    db = get_supabase()
    service.one(db, 'exercise_sets', g.user_id, id)
    title = service.text(body().get('title', ''), 200)
    if not title:
        raise service.ExerciseError('Give your set a title.')
    db.table('exercise_sets').update({'title': title}).eq('user_id', g.user_id).eq('id', id).execute()
    return jsonify(service.one(db, 'exercise_sets', g.user_id, id))

@exercises_bp.delete('/sets/<id>')
def delete_set(id):
    db = get_supabase()
    item = service.one(db, 'exercise_sets', g.user_id, id)
    if body().get('confirmation') != item['title']:
        raise service.ExerciseError('Type the exact set title to delete its exercises and attempt history.')
    db.table('exercise_sets').delete().eq('user_id', g.user_id).eq('id', id).execute()
    if db.table('exercise_sets').select('id').eq('user_id', g.user_id).eq('id', id).execute().data:
        raise service.ExerciseError('Deletion was not confirmed.', 503)
    return jsonify({'deleted': True})

@exercises_bp.get('/items/<id>')
def item(id):
    db = get_supabase()
    row = service.one(db, 'exercises', g.user_id, id)
    history = service.pages(db, 'exercise_attempts', g.user_id, lambda q: q.eq('exercise_id', id), limit=10000)
    history.sort(key=lambda r: r['created_at'], reverse=True)
    return jsonify({'exercise': row, 'history': history[:20]})

@exercises_bp.delete('/items/<id>')
def delete_item(id):
    db = get_supabase()
    service.one(db, 'exercises', g.user_id, id)
    if body().get('confirmation') != 'DELETE EXERCISE':
        raise service.ExerciseError('Confirm deletion of this exercise and its attempts.')
    db.table('exercises').delete().eq('user_id', g.user_id).eq('id', id).execute()
    return jsonify({'deleted': not db.table('exercises').select('id').eq('user_id', g.user_id).eq('id', id).execute().data})

@exercises_bp.post('/import/preview')
def preview():
    return jsonify(service.prepare_import(get_supabase(), g.user_id, body()))

@exercises_bp.post('/import/commit')
def commit():
    return jsonify(service.commit_import(get_supabase(), g.user_id, body()))

@exercises_bp.get('/sessions')
def sessions():
    rows = service.pages(get_supabase(), 'exercise_sessions', g.user_id, limit=1000)
    rows.sort(key=lambda r: r['updated_at'], reverse=True)
    return jsonify({'items': rows[:20]})

@exercises_bp.post('/sessions')
def start():
    return (jsonify(service.start_session(get_supabase(), g.user_id, body())), 201)

@exercises_bp.get('/sessions/<id>')
def session(id):
    return jsonify(service.session_detail(get_supabase(), g.user_id, id))

@exercises_bp.post('/sessions/<id>/answer')
def answer(id):
    return jsonify(service.answer(get_supabase(), g.user_id, id, body()))

@exercises_bp.post('/sessions/<id>/rate')
def rate(id):
    return jsonify(service.rate(get_supabase(), g.user_id, id, body()))

@exercises_bp.post('/sessions/<id>/end')
def end(id):
    db = get_supabase()
    s = service.one(db, 'exercise_sessions', g.user_id, id)
    db.table('exercise_sessions').update({'status': 'ended'}).eq('user_id', g.user_id).eq('id', s['id']).execute()
    return jsonify(service.session_detail(db, g.user_id, id))
