from flask import Blueprint, request, jsonify, g
from services.supabase_client import supabase

collections_bp = Blueprint('collections', __name__)

@collections_bp.route('', methods=['GET'])
def list_collections():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    try:
        response = supabase.table('collections').select('*, words(count)').eq('user_id', g.user_id).execute()
        items = []
        for col in response.data:
            word_count = 0
            words_data = col.pop('words', [])
            if words_data and isinstance(words_data, list) and len(words_data) > 0:
                word_count = words_data[0].get('count', 0)
            col['word_count'] = word_count
            items.append(col)
        return jsonify({"items": items, "count": len(items)})
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@collections_bp.route('/<collection_id>', methods=['GET'])
def get_collection(collection_id):
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    try:
        response = supabase.table('collections').select('*').eq('id', collection_id).eq('user_id', g.user_id).execute()
        if not response.data:
            return jsonify({"message": f"Collection {collection_id} not found"}), 404
        return jsonify(response.data[0])
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@collections_bp.route('', methods=['POST'], strict_slashes=False)
def create_collection():
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
        return jsonify({'message': 'Collection name must contain 1–255 characters.'}), 400
    try:
        insert_data = {
            "name": name.strip(),
            "description": data.get("description", ""),
            "user_id": g.user_id
        }
        
        response = supabase.table('collections').insert(insert_data).execute()
        return jsonify(response.data[0]), 201
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@collections_bp.route('/<collection_id>', methods=['PUT'])
def update_collection(collection_id):
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        if not isinstance(data['name'],str) or not data['name'].strip() or len(data['name'].strip())>255:
            return jsonify({'message':'Collection name must contain 1–255 characters.'}),400
        data['name']=data['name'].strip()
    try:
        update_data = {}
        for key in ["name", "description"]:
            if key in data:
                update_data[key] = data[key]
                
        response = supabase.table('collections').update(update_data).eq('id', collection_id).eq('user_id', g.user_id).execute()
        if not response.data:
            return jsonify({"message": f"Collection {collection_id} not found"}), 404
        return jsonify(response.data[0])
    except Exception as e:
        return jsonify({"message": str(e)}), 500

@collections_bp.route('/<collection_id>', methods=['DELETE'])
def delete_collection(collection_id):
    if not supabase:
        return jsonify({"message": "Supabase client not initialized"}), 500
        
    try:
        response = supabase.table('collections').delete().eq('id', collection_id).eq('user_id', g.user_id).execute()
        if not response.data:
            return jsonify({"message": f"Collection {collection_id} not found"}), 404
        return jsonify({"message": f"Collection {collection_id} deleted successfully"})
    except Exception as e:
        return jsonify({"message": str(e)}), 500
