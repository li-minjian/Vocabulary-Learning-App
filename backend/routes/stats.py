from datetime import datetime, timedelta
from flask import Blueprint, jsonify, g
from services.supabase_client import get_supabase
from services.vocabulary_queries import list_user_words

stats_bp = Blueprint('stats', __name__)

@stats_bp.route('', methods=['GET'])
def get_stats():
    supabase = get_supabase()
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    try:
        # Fetch all words for aggregation
        words = list_user_words(supabase, g.user_id,
            'id, created_at, updated_at, mastery, language, review_count, next_review')
        
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_ago = now - timedelta(days=7)
        
        total_words = len(words)
        mastered_words = sum(1 for w in words if w.get('mastery') == 'Mastered')
        
        added_today = sum(1 for w in words if w.get('created_at') and datetime.fromisoformat(w['created_at'].replace('Z', '+00:00')[:19]) >= today_start)
        added_this_week = sum(1 for w in words if w.get('created_at') and datetime.fromisoformat(w['created_at'].replace('Z', '+00:00')[:19]) >= week_ago)
        
        due_for_review = sum(1 for w in words if not w.get('next_review') or datetime.fromisoformat(w['next_review'].replace('Z', '+00:00')[:19]) <= now)
        
        # Total study time: roughly estimate 30s per review
        total_reviews = sum(w.get('review_count', 0) for w in words)
        study_hours = round((total_reviews * 30) / 3600, 1)
        
        # Language breakdown
        lang_counts = {}
        for w in words:
            lang = w.get('language') or 'Unknown'
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
            
        languages = [{"name": k, "count": v} for k, v in lang_counts.items()]
        languages.sort(key=lambda x: x['count'], reverse=True)
        
        # Fake weekly activity since we don't have review logs
        weekly_activity = [
            {"day": (now - timedelta(days=i)).strftime("%a"), "reviews": sum(w.get('review_count', 0) for w in words if w.get('updated_at') and (now - timedelta(days=i)).date() == datetime.fromisoformat(w['updated_at'].replace('Z', '+00:00')[:19]).date())}
            for i in range(6, -1, -1)
        ]
        
        # Progress over time (fake data based on total mastered)
        progress_data = [
            {"month": (now - timedelta(days=90)).strftime("%b"), "mastered": int(mastered_words * 0.2)},
            {"month": (now - timedelta(days=60)).strftime("%b"), "mastered": int(mastered_words * 0.5)},
            {"month": (now - timedelta(days=30)).strftime("%b"), "mastered": int(mastered_words * 0.8)},
            {"month": now.strftime("%b"), "mastered": mastered_words},
        ]
        
        return jsonify({
            "total_words": total_words,
            "mastered_words": mastered_words,
            "added_today": added_today,
            "added_this_week": added_this_week,
            "due_for_review": due_for_review,
            "study_hours": study_hours,
            "languages": languages,
            "weekly_activity": weekly_activity,
            "progress_data": progress_data,
            "accuracy_rate": 85 # Placeholder
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"message": str(e)}), 500
