"""Persist reading material using the existing imported_text/RLS owner."""
import uuid

from flask import Blueprint, g, jsonify, request
from services.supabase_client import get_supabase

articles_bp = Blueprint("articles", __name__)
MAX_ARTICLE_LENGTH = 100_000


@articles_bp.get("")
def list_articles():
    try:
        result = (get_supabase().table("imported_text").select("*")
                  .eq("user_id", g.user_id).order("created_at", desc=True).limit(200).execute())
        return jsonify({"items": result.data})
    except Exception:
        return jsonify({"message": "Unable to load articles. Check the imported_text table and connection."}), 503


@articles_bp.get("/<article_id>")
def get_article(article_id):
    try:
        uuid.UUID(article_id)
    except ValueError:
        return jsonify({"message": "Invalid article ID"}), 400
    try:
        result = (get_supabase().table("imported_text").select("*")
                  .eq("user_id", g.user_id).eq("id", article_id).execute())
        if not result.data:
            return jsonify({"message": "Article not found"}), 404
        return jsonify(result.data[0])
    except Exception:
        return jsonify({"message": "Unable to load article"}), 503


@articles_bp.post("")
def create_article():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"message": "Expected a JSON object"}), 400
    text = data.get("raw_text")
    title = data.get("title", "Untitled article")
    language = data.get("language", "English")
    source_type = data.get("source_type", "paste")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_ARTICLE_LENGTH:
        return jsonify({"message": "Article must contain 1–100,000 characters"}), 400
    if not isinstance(title, str) or len(title) > 250:
        return jsonify({"message": "Title must be at most 250 characters"}), 400
    if language not in {"English", "German", "French", "Spanish", "Japanese"}:
        return jsonify({"message": "Unsupported article language"}), 400
    if source_type not in {"paste", "article_import", "text_file"}:
        return jsonify({"message": "Unsupported article source"}), 400
    # Deterministic per-user content ID makes response-loss retries safe; no SRS writes.
    article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"voca:article:{g.user_id}:{language}:{title}:{text}"))
    try:
        client = get_supabase()
        existing = (client.table("imported_text").select("*")
                    .eq("user_id", g.user_id).eq("id", article_id).execute())
        if existing.data:
            return jsonify(existing.data[0]), 200
        result = client.table("imported_text").upsert({
            "id": article_id, "user_id": g.user_id, "title": title.strip() or "Untitled article",
            "raw_text": text.replace("\r\n", "\n").replace("\r", "\n"),
            "language": language, "source_type": source_type,
        }, on_conflict="id", ignore_duplicates=True).execute()
        if result.data:
            return jsonify(result.data[0]), 201
        saved = (client.table("imported_text").select("*")
                 .eq("user_id", g.user_id).eq("id", article_id).execute())
        if saved.data:
            return jsonify(saved.data[0]), 200
        raise RuntimeError("No saved article returned")
    except Exception:
        return jsonify({"message": "Unable to save article. Your text is retained; retry when storage is available."}), 503
