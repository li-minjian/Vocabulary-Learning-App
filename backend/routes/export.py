from flask import Blueprint, jsonify, request, Response, g
from services.supabase_client import supabase
from services.vocabulary_queries import list_user_words
import io
import csv

export_bp = Blueprint('export', __name__)

@export_bp.route('/vocabulary', methods=['GET'])
@export_bp.route('/words', methods=['GET'])
def export_vocabulary():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
    try:
        format_param = request.args.get('format', 'json').lower()
        if format_param == 'csv':
            words = list_user_words(supabase, g.user_id)
            collections_res = supabase.table('collections').select('id, name').execute()
            collection_map = {c['id']: c['name'] for c in collections_res.data} if collections_res.data else {}
            
            output = io.StringIO()
            output.write("\ufeff")
            writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
            
            writer.writerow([
                "word",
                "ipa",
                "translation",
                "definition",
                "example_sentence",
                "collection_name",
                "difficulty",
                "created_at"
            ])
            
            if words:
                for word in words:
                    coll_id = word.get('collection_id')
                    coll_name = collection_map.get(coll_id) if coll_id else ""
                    example_sentence = word.get('example_sentence') or ""
                    
                    writer.writerow([
                        word.get('word') or "",
                        word.get('ipa') or "",
                        word.get('translation') or "",
                        word.get('definition') or "",
                        example_sentence,
                        coll_name,
                        word.get('difficulty') or "",
                        word.get('created_at') or ""
                    ])
            
            csv_data = output.getvalue()
            output.close()
            
            return Response(
                csv_data,
                mimetype="text/csv; charset=utf-8",
                headers={"Content-disposition": "attachment; filename=voca_words_export.csv"}
            )
        else:
            words = list_user_words(supabase, g.user_id,
                '*, examples(*), collocations(*), synonyms(*), tags:word_tags(tag:tags(*))')
            return jsonify(words)
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@export_bp.route('/collections', methods=['GET'])
def export_collections():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
    try:
        response = supabase.table('collections').select('*').execute()
        return jsonify(response.data)
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@export_bp.route('/review-progress', methods=['GET'])
def export_review_progress():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
    try:
        words = list_user_words(supabase, g.user_id,
            'id, word, mastery, next_review, review_count, updated_at')
        return jsonify(words)
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@export_bp.route('/all', methods=['GET'])
def export_all():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
    try:
        words = list_user_words(supabase, g.user_id,
            '*, examples(*), collocations(*), synonyms(*), tags:word_tags(tag:tags(*))')
        collections_res = supabase.table('collections').select('*').execute()
        
        return jsonify({
            "vocabulary": words,
            "collections": collections_res.data
        })
    except Exception as e:
        return jsonify({"message": str(e)}), 500
