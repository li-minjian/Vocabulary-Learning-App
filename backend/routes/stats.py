import logging
import uuid
from flask import Blueprint, jsonify, g, request
from services.supabase_client import get_supabase

stats_bp = Blueprint('stats', __name__)

@stats_bp.route('/learning', methods=['GET'])
def learning_stats():
    try:
        set_id = request.args.get('set')
        result = get_supabase().rpc('learning_summary', {
            'p_collection': request.args.get('collection') or 'all',
            'p_set': str(uuid.UUID(set_id)) if set_id else None,
            'p_category': request.args.get('category', ''), 'p_unit': request.args.get('unit', ''),
            'p_deck': request.args.get('deck', ''), 'p_timezone': request.args.get('timezone', 'UTC'),
        }).execute().data
        return jsonify(result)
    except Exception as error:
        logging.getLogger(__name__).warning('learning_summary_failed error_class=%s', type(error).__name__)
        return jsonify({'message': 'Learning summary unavailable. Check the selected Collection, set and time zone.'}), 400

@stats_bp.route('', methods=['GET'])
def get_stats():
    # Keep the established Dashboard contract while removing invented history/accuracy.
    response = learning_stats()
    if isinstance(response, tuple):
        return response
    data = response.get_json()
    v, e = data['vocabulary'], data['exercises']
    return jsonify({**data, 'total_words': v['total'], 'mastered_words': v['mastered'],
        'added_today': v['added_today'], 'added_this_week': v['added_this_week'],
        'due_for_review': v['due'] + e['due'], 'vocabulary_due': v['due'], 'exercise_due': e['due'],
        'study_hours': None, 'accuracy_rate': None, 'progress_data': [],
        'weekly_activity': [{**day, 'reviews': day['vocabulary'] + day['exercises']} for day in data['activity']]})
