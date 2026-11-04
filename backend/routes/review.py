"""Vocabulary owns practice receipts and review scheduling; Learn only orchestrates."""
import logging
import uuid
from flask import Blueprint, request, jsonify, g
from services.supabase_client import get_supabase

review_bp = Blueprint('review', __name__)

@review_bp.route('/queue', methods=['GET'])
def get_queue():
    try:
        limit = max(1, min(200, int(request.args.get('limit', 20))))
        rows = get_supabase().rpc('vocabulary_queue', {
            'p_collection': request.args.get('collection_id') or 'all', 'p_limit': limit,
            'p_mode': request.args.get('mode', 'review'),
            'p_include_unscheduled': request.args.get('include_unscheduled', 'true') == 'true',
        }).execute().data
        return jsonify({'items': rows, 'count': len(rows)})
    except (ValueError, TypeError):
        return jsonify({'message': 'Choose a session size from 1 to 200.'}), 400
    except Exception as error:
        logging.getLogger(__name__).warning('vocabulary_queue_failed error_class=%s', type(error).__name__)
        return jsonify({'message': 'Queue unavailable. Check the selected Collection and retry.'}), 400

@review_bp.route('/answer', methods=['POST'])
def submit_answer():
    data = request.get_json(silent=True) or {}
    try:
        params = {'p_id': str(uuid.UUID(str(data.get('id') or uuid.uuid4()))),
                  'p_session': str(uuid.UUID(str(data.get('session_id') or uuid.uuid4()))),
                  'p_word': str(uuid.UUID(str(data.get('word_id')))),
                  'p_mode': data.get('mode', 'review'), 'p_format': data.get('format', 'flashcard'),
                  'p_rating': data.get('answer'), 'p_response': data.get('response'),
                  'p_revealed': data.get('revealed', True)}
        if params['p_rating'] not in ('again', 'hard', 'good', 'easy') or params['p_mode'] not in ('review', 'practice') or params['p_format'] not in ('flashcard', 'multipleChoice', 'spelling') or type(params['p_revealed']) != bool:
            raise ValueError()
        if params['p_response'] is not None and (not isinstance(params['p_response'], str) or len(params['p_response']) > 2000):
            raise ValueError()
        db = get_supabase()
        receipt = db.rpc('record_vocabulary_attempt', params).execute().data
        if not data.get('session_id'):
            # Historical clients expect the updated word, while new sessions use receipts.
            word = db.table('words').select('*').eq('user_id', g.user_id).eq('id', params['p_word']).execute().data
            return jsonify(word[0])
        return jsonify(receipt)
    except (ValueError, TypeError):
        return jsonify({'message': 'Invalid vocabulary answer.'}), 400
    except Exception as error:
        logging.getLogger(__name__).warning('vocabulary_answer_unconfirmed error_class=%s', type(error).__name__)
        return jsonify({'message': 'Answer was not confirmed. Retry with the same session; progress will not be counted twice.'}), 503

@review_bp.route('/sessions/<session_id>/attempts', methods=['GET'])
def session_attempts(session_id):
    try:
        session_id = str(uuid.UUID(session_id))
    except ValueError:
        return jsonify({'message': 'Invalid session identifier.'}), 400
    rows = get_supabase().table('vocabulary_attempts').select('*').eq('user_id', g.user_id).eq('session_id', session_id).order('created_at').limit(200).execute().data
    return jsonify({'items': rows})

@review_bp.route('/queue/resolve', methods=['POST'])
def resolve_queue():
    """Restore a bounded browser checkpoint without one HTTP request per word."""
    data = request.get_json(silent=True) or {}
    try:
        ids = data.get('ids')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 200:
            raise ValueError()
        ids = [str(uuid.UUID(str(value))) for value in ids]
        if len(set(ids)) != len(ids):
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({'message': 'Invalid vocabulary checkpoint.'}), 400
    rows = get_supabase().table('words').select('*').eq('user_id', g.user_id).in_('id', ids).execute().data
    owned = {row['id']: row for row in rows}
    if any(id not in owned for id in ids):
        return jsonify({'message': 'An item in this session is unavailable or was deleted. Start a new queue in Learn.'}), 409
    return jsonify({'items': [owned[id] for id in ids]})
