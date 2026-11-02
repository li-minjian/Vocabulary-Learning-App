from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, g
from services.supabase_client import get_supabase

review_bp = Blueprint('review', __name__)

@review_bp.route('/queue', methods=['GET'])
def get_queue():
    limit_raw = request.args.get('limit', '20')
    try:
        limit = int(float(limit_raw))
    except (ValueError, TypeError):
        limit = 20
        
    # Clamp limit: minimum 1, maximum 200
    if limit < 1:
        limit = 20
    elif limit > 200:
        limit = 200
        
    collection_id = request.args.get('collection_id')
    supabase = get_supabase()
    
    # Get words where next_review is null or in the past
    try:
        now_str = datetime.utcnow().isoformat()
        query = supabase.table('words').select('*').eq('user_id', g.user_id).or_(f"next_review.is.null,next_review.lte.{now_str}")
        if collection_id and collection_id != "all":
            query = query.eq('collection_id', collection_id)
            
        response = query.limit(limit).execute()
        return jsonify({"items": response.data, "count": len(response.data)}), 200
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@review_bp.route('/answer', methods=['POST'])
def submit_answer():
    data = request.json
    word_id = data.get('word_id')
    answer = data.get('answer') # 'again', 'hard', 'good', 'easy'
    
    if not word_id or not answer:
        return jsonify({"message": "word_id and answer are required"}), 400
        
    supabase = get_supabase()
    
    try:
        # Fetch current word stats
        word_res = supabase.table('words').select('review_count, mastery').eq('id', word_id).eq('user_id', g.user_id).single().execute()
        word = word_res.data
        
        if not word:
            return jsonify({"message": "Word not found"}), 404
            
        review_count = word.get('review_count', 0) + 1
        
        # Super basic SRS logic
        next_interval_days = 1
        new_mastery = "Learning"
        
        if answer == 'again':
            next_interval_days = 0 # review today/tomorrow
            new_mastery = "Learning"
        elif answer == 'hard':
            next_interval_days = 1 * review_count
            new_mastery = "Learning"
        elif answer == 'good':
            next_interval_days = 3 * review_count
            new_mastery = "Familiar"
        elif answer == 'easy':
            next_interval_days = 5 * review_count
            new_mastery = "Mastered"
            
        next_review_time = datetime.utcnow() + timedelta(days=next_interval_days)
        
        # Update word
        update_data = {
            "review_count": review_count,
            "mastery": new_mastery,
            "next_review": next_review_time.isoformat()
        }
        
        res = supabase.table('words').update(update_data).eq('id', word_id).eq('user_id', g.user_id).execute()
        
        return jsonify(res.data[0]), 200
    except Exception as e:
        return jsonify({"message": str(e)}), 500
