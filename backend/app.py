import os

from flask import Flask, jsonify, request, g, abort
from flask_cors import CORS
from services.supabase_client import get_supabase

from config import Config
from routes.words import words_bp
from routes.collections import collections_bp
from routes.tags import tags_bp
from routes.ai import ai_bp
from routes.import_text import import_bp
from routes.review import review_bp
from routes.stats import stats_bp
from routes.export import export_bp
from routes.articles import articles_bp
from routes.file_import import file_import_bp
from routes.dictionary import dictionary_bp
from routes.uploads import uploads_bp
print("[APP_VERSION] supabase-config-diag-v2", flush=True)

def create_app() -> Flask:
    app = Flask(__name__)
    
    # Secure CORS configuration using FRONTEND_ORIGINS/FRONTEND_ORIGIN or fallback whitelists
    frontend_origins = os.getenv("FRONTEND_ORIGINS") or os.getenv("FRONTEND_ORIGIN")
    allowed_origins = ["http://localhost:5173", "http://localhost:3000", "https://voca118.vercel.app"]
    if frontend_origins:
        origins_list = [orig.strip() for orig in frontend_origins.split(",") if orig.strip()]
        allowed_origins.extend(origins_list)
        
    CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

    @app.get("/api/health")
    def health_check():
        return jsonify(
            {
                "ok": True,
                "service": "flask-vocabulary-service",
            }
        )

    @app.get('/api/health/dictionary')
    def dictionary_readiness():
        from services.dictionary_health import dictionary_health
        result = dictionary_health()
        return jsonify(result), 200 if result['ready'] else 503

    @app.before_request
    def authenticate():
        if request.method == "OPTIONS":
            return
        if request.path.startswith("/api/health"):
            return
            
        auth_header = request.headers.get("Authorization")
        auth_header_present = auth_header is not None
        bearer_token_present = False
        if auth_header_present:
            bearer_token_present = auth_header.startswith("Bearer ")

        supabase_url = Config.SUPABASE_URL
        supabase_key = Config.SUPABASE_KEY
        supabase_client_configured = False
        if supabase_url and supabase_key and supabase_url != "your_supabase_url":
            supabase_client_configured = True

        supabase_url_present = supabase_url is not None
        supabase_url_format_ok = (supabase_url.startswith("https://") and ".supabase." in supabase_url) if supabase_url_present else False
        
        key_present = supabase_key is not None
        key_format_is_publishable = (supabase_key.startswith("sb_publishable_") or supabase_key.startswith("sbp_")) if key_present else False
        key_format_is_legacy_jwt = supabase_key.startswith("eyJhbGciOi") if key_present else False
        key_length = len(supabase_key) if key_present else 0

        anon_jwt_ref_present = False
        anon_jwt_ref_matches_url = False
        anon_jwt_role_is_anon = False

        if key_present and key_format_is_legacy_jwt:
            import base64
            import json
            try:
                parts = supabase_key.split(".")
                if len(parts) >= 2:
                    payload_b64 = parts[1]
                    missing_padding = len(payload_b64) % 4
                    if missing_padding:
                        payload_b64 += "=" * (4 - missing_padding)
                    decoded_bytes = base64.urlsafe_b64decode(payload_b64)
                    payload = json.loads(decoded_bytes)
                    
                    if isinstance(payload, dict):
                        role = payload.get("role")
                        anon_jwt_role_is_anon = (role == "anon")
                        
                        jwt_project_ref = None
                        ref_val = payload.get("ref")
                        if isinstance(ref_val, str) and ref_val.strip():
                            jwt_project_ref = ref_val.strip()
                        else:
                            iss = payload.get("iss")
                            if isinstance(iss, str) and iss.startswith("https://"):
                                jwt_ref_parts = iss.split("https://")[1].split(".")
                                if len(jwt_ref_parts) > 0:
                                    jwt_project_ref = jwt_ref_parts[0]
                                    
                        if jwt_project_ref:
                            anon_jwt_ref_present = True
                            
                            # Extract project ref from SUPABASE_URL
                            if supabase_url and supabase_url.startswith("https://"):
                                url_ref_parts = supabase_url.split("https://")[1].split(".")
                                if len(url_ref_parts) > 0:
                                    url_project_ref = url_ref_parts[0]
                                    if url_project_ref:
                                        anon_jwt_ref_matches_url = (jwt_project_ref == url_project_ref)
            except Exception as e:
                print(f"[AUTH_DIAG] jwt_decode_exception_type={type(e).__name__}", flush=True)

        print(f"[AUTH_DIAG] auth_header_present={'true' if auth_header_present else 'false'}", flush=True)
        print(f"[AUTH_DIAG] bearer_token_present={'true' if bearer_token_present else 'false'}", flush=True)
        print(f"[AUTH_DIAG] supabase_client_configured={'true' if supabase_client_configured else 'false'}", flush=True)
        print("[AUTH_DIAG] auth_validation_method=get_user", flush=True)
        print(f"[AUTH_DIAG] supabase_key_source={Config.SUPABASE_KEY_SOURCE}", flush=True)
        print(f"[AUTH_DIAG] supabase_url_present={'true' if supabase_url_present else 'false'}", flush=True)
        print(f"[AUTH_DIAG] supabase_url_format_ok={'true' if supabase_url_format_ok else 'false'}", flush=True)
        print(f"[AUTH_DIAG] key_present={'true' if key_present else 'false'}", flush=True)
        print(f"[AUTH_DIAG] key_format_is_publishable={'true' if key_format_is_publishable else 'false'}", flush=True)
        print(f"[AUTH_DIAG] key_format_is_legacy_jwt={'true' if key_format_is_legacy_jwt else 'false'}", flush=True)
        print(f"[AUTH_DIAG] key_length_bucket={'0' if key_length == 0 else 'under_100' if key_length < 100 else '100_to_200' if key_length < 200 else 'over_200'}", flush=True)
        print(f"[AUTH_DIAG] anon_jwt_ref_present={'true' if anon_jwt_ref_present else 'false'}", flush=True)
        print(f"[AUTH_DIAG] anon_jwt_ref_matches_url={'true' if anon_jwt_ref_matches_url else 'false'}", flush=True)
        print(f"[AUTH_DIAG] anon_jwt_role_is_anon={'true' if anon_jwt_role_is_anon else 'false'}", flush=True)

        if not auth_header or not auth_header.startswith("Bearer "):
            print("[AUTH_DIAG] supabase_get_user_success=false", flush=True)
            reason = "missing_header" if not auth_header else "malformed_header"
            print(f"[AUTH_DIAG] auth_failure_reason={reason}", flush=True)
            abort(401, "Missing or invalid Authorization header")
            
        token = auth_header.split(" ")[1]
        
        if Config.ENABLE_AUTH_BYPASS and token == "fake-test-token":
            g.token = token
            g.user_id = "00000000-0000-0000-0000-000000000000"
            print("[AUTH_DIAG] test_bypass_active=true", flush=True)
            return
            
        try:
            g.token = token
            supabase = get_supabase()
            user_response = supabase.auth.get_user(token)
            
            if not user_response or not user_response.user:
                print("[AUTH_DIAG] supabase_get_user_success=false", flush=True)
                print("[AUTH_DIAG] auth_failure_reason=get_user_failed", flush=True)
                abort(401, "Invalid token")
                
            g.user_id = user_response.user.id
            print("[AUTH_DIAG] supabase_get_user_success=true", flush=True)
        except Exception as e:
            print("[AUTH_DIAG] supabase_get_user_success=false", flush=True)
            print("[AUTH_DIAG] auth_failure_reason=get_user_failed", flush=True)
            print(f"[AUTH_DIAG] Exception: {str(e)}", flush=True)
            abort(401, f"Authentication error: {str(e)}")

    app.register_blueprint(words_bp, url_prefix='/api/words')
    app.register_blueprint(collections_bp, url_prefix='/api/collections')
    app.register_blueprint(tags_bp, url_prefix='/api/tags')
    app.register_blueprint(ai_bp, url_prefix='/api/ai')
    app.register_blueprint(import_bp, url_prefix='/api/import')
    app.register_blueprint(review_bp, url_prefix='/api/review')
    app.register_blueprint(stats_bp, url_prefix='/api/stats')
    app.register_blueprint(export_bp, url_prefix='/api/export')
    app.register_blueprint(articles_bp, url_prefix='/api/articles')
    app.register_blueprint(file_import_bp, url_prefix='/api/file-import')
    app.register_blueprint(dictionary_bp, url_prefix='/api/dictionary')
    app.register_blueprint(uploads_bp, url_prefix='/api/uploads')

    return app

app = create_app()

if __name__ == "__main__":
    app.run(host=Config.FLASK_HOST, port=Config.FLASK_PORT, debug=Config.FLASK_DEBUG)
