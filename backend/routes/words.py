import uuid
from flask import Blueprint, request, jsonify, g
from services.supabase_client import supabase
from services.vocabulary_queries import list_user_words

words_bp = Blueprint('words', __name__)

def resolve_collection_id(val, user_id):
    if not val:
        return None
    val_str = str(val).strip()
    if not val_str:
        return None
        
    query = supabase.table('collections').select('id').eq('user_id', user_id)
    try:
        collection_uuid = str(uuid.UUID(val_str))
    except ValueError:
        query = query.eq('name', val_str)
    else:
        query = query.eq('id', collection_uuid)
    result = query.execute().data or []
    if not result:
        raise ValueError('Destination collection is unavailable or belongs to another user.')
    return result[0]['id']

@words_bp.route('', methods=['GET'])
def list_words():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    try:
        items = list_user_words(supabase, g.user_id,
            '*, examples(*), collocations(*), synonyms(*), tags:word_tags(tag:tags(*))',
            request.args.get('collection_id'))
        return jsonify({"items": items, "count": len(items)})
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@words_bp.route('/<word_id>', methods=['GET'])
def get_word(word_id):
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    try:
        response = supabase.table('words').select('*, examples(*), collocations(*), synonyms(*), tags:word_tags(tag:tags(*))').eq('id', word_id).eq('user_id', g.user_id).execute()
        if not response.data:
            return jsonify({"message": f"Word {word_id} not found"}), 404
        return jsonify(response.data[0])
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@words_bp.route('', methods=['POST'])
def create_word():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    data = request.json
    try:
        # Expected fields: word, translation, pos, language, definition, source, etc.
        collection_id_raw = data.get("collection_id") or data.get("collection")
        collection_id = resolve_collection_id(collection_id_raw, g.user_id)
        insert_data = {
            "word": data.get("word"),
            "ipa": data.get("ipa"),
            "translation": data.get("translation"),
            "pos": data.get("pos"),
            "language": data.get("language", "English"),
            "definition": data.get("definition"),
            "source": data.get("source"),
            "mastery": data.get("mastery", "Learning"),
            "collection_id": collection_id,
            "user_id": g.user_id
        }
        
        response = supabase.table('words').insert(insert_data).execute()
        word_id = response.data[0]['id']
        
        # Insert examples
        examples = data.get("examples", [])
        if examples:
            example_inserts = []
            for ex in examples:
                if isinstance(ex, dict):
                    example_inserts.append({"word_id": word_id, "sentence": ex.get("sentence", ""), "translation": ex.get("translation", ""), "user_id": g.user_id})
                else:
                    example_inserts.append({"word_id": word_id, "sentence": str(ex), "user_id": g.user_id})
            supabase.table('examples').insert(example_inserts).execute()
            
        # Insert collocations
        collocations = data.get("collocations", [])
        if collocations:
            coll_inserts = [{"word_id": word_id, "phrase": c, "user_id": g.user_id} for c in collocations]
            supabase.table('collocations').insert(coll_inserts).execute()
            
        # Insert synonyms and relatedWords
        synonyms = data.get("synonyms", [])
        if synonyms:
            syn_inserts = [{"word_id": word_id, "related_word": s, "relation_type": "synonym", "user_id": g.user_id} for s in synonyms]
            supabase.table('synonyms').insert(syn_inserts).execute()
            
        related_words = data.get("relatedWords", [])
        if related_words:
            rel_inserts = [{"word_id": word_id, "related_word": r, "relation_type": "related", "user_id": g.user_id} for r in related_words]
            supabase.table('synonyms').insert(rel_inserts).execute()
            
        # Refetch with relations
        new_word = supabase.table('words').select('*, examples(*), collocations(*), synonyms(*), tags:word_tags(tag:tags(*))').eq('id', word_id).eq('user_id', g.user_id).execute()
        return jsonify(new_word.data[0]), 201
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@words_bp.route('/<word_id>', methods=['PUT'])
def update_word(word_id):
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    data = request.json
    try:
        update_data = {}
        for key in ["word", "ipa", "translation", "pos", "language", "definition", "source", "mastery"]:
            if key in data:
                update_data[key] = data[key]
                
        collection_id_raw = data.get("collection_id") or data.get("collection")
        if collection_id_raw is not None:
            update_data["collection_id"] = resolve_collection_id(collection_id_raw, g.user_id)
                
        response = supabase.table('words').update(update_data).eq('id', word_id).eq('user_id', g.user_id).execute()
        if not response.data:
            return jsonify({"message": f"Word {word_id} not found"}), 404
        return jsonify(response.data[0])
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@words_bp.route('/<word_id>', methods=['DELETE'])
def delete_word(word_id):
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    from services.vocabulary_management import BackupStore, ManagementError, batch_delete
    try:
        result = batch_delete(supabase, g.user_id, [word_id], BackupStore())
        return jsonify(result), 200 if result['complete'] else 409
    except ManagementError as error:
        return jsonify({'message': str(error)}), error.status
    except Exception:
        return jsonify({'message': 'Deletion could not be verified. Refresh before retrying.'}), 503
