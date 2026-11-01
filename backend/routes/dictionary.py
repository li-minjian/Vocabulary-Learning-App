from flask import Blueprint, jsonify, request
from services.dictionary_service import resolver
import sqlite3

dictionary_bp = Blueprint("dictionary", __name__)


@dictionary_bp.get("")
def lookup():
    try:
        return jsonify(resolver.lookup(request.args.get("q", ""), request.args.get("language", "English")))
    except ValueError as error:
        return jsonify({"message": str(error)}), 400
    except (sqlite3.Error, OSError):
        return jsonify({"message": "Local dictionary is unavailable. Reinstall the dictionary and retry."}), 503


@dictionary_bp.post("/phrases")
def phrases():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"message": "A JSON object is required"}), 400
    try:
        return jsonify({"items": resolver.phrase_spans(data.get("text", ""), data.get("language", "English"))})
    except ValueError as error:
        return jsonify({"message": str(error)}), 400
    except (sqlite3.Error, OSError):
        return jsonify({"message": "Local dictionary is unavailable. Reinstall the dictionary and retry."}), 503
