from flask import Blueprint, request, jsonify
from services.ai_service import analyze_text_for_words, check_typo

import_bp = Blueprint('import_text', __name__)

def is_quota_error(e):
    err_str = str(e).lower()
    return "429" in err_str or "quota" in err_str or "rate limit" in err_str or "resource_exhausted" in err_str or "resource exhausted" in err_str

@import_bp.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    text = data.get('text')
    language = data.get('language', 'English')
    level = data.get('level', 'Intermediate')
    goal = data.get('goal', 'General')
    count = data.get('count', 10)
    native_language = data.get('native_language', 'Chinese')
    
    if not text:
        return jsonify({"message": "Text is required"}), 400
        
    try:
        candidates = analyze_text_for_words(text, language, level, goal, count, native_language)
        return jsonify({"candidates": candidates}), 200
    except Exception as e:
        if is_quota_error(e):
            return jsonify({
                "message": "AI text analysis is temporarily unavailable. Please try again later. You can still add words manually."
            }), 429
        return jsonify({"message": "AI service is temporarily unavailable. Please try again later."}), 500

@import_bp.route('/extract-text', methods=['POST'])
def extract_text():
    return jsonify({'message': 'Base64 document uploads are no longer supported. Use authorized object upload and explicit extraction.'}), 410

@import_bp.route('/check-typo', methods=['POST'])
def verify_typo():
    data = request.json
    text = data.get('text')
    typed_word = data.get('typed_word')
    
    if not text or not typed_word:
        return jsonify({"message": "text and typed_word are required"}), 400
        
    try:
        result = check_typo(text, typed_word)
        return jsonify(result), 200
    except Exception as e:
        if is_quota_error(e):
            return jsonify({
                "message": "AI spelling assistant is temporarily unavailable. Please try again later."
            }), 429
        return jsonify({"message": "AI service is temporarily unavailable. Please try again later."}), 500
