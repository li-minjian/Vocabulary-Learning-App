"""Local-only E2E dependency doubles; production auth and schema stay unchanged.

Run from backend: .venv/bin/python tests/e2e/fixture_server.py
This server never reads .env or contacts Supabase/AI. Authentication fixtures
are public test values, not credentials. Storage is discarded when it stops.
"""
import copy
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.serving import run_simple

USER = '11111111-1111-1111-1111-111111111111'
COLLECTION = '33333333-3333-3333-3333-333333333333'


class Query:
    def __init__(self, db, table):
        self.db, self.table_name, self.filters = db, table, []
        self.operation, self.values, self.bounds = 'read', None, None

    def select(self, fields='*'): self.fields = fields; return self
    def order(self, *_, **__): return self
    def limit(self, count): self.bounds = (0, count); return self
    def range(self, start, end): self.bounds = (start, end + 1); return self
    def eq(self, key, value): self.filters.append(lambda row: row.get(key) == value); return self
    def in_(self, key, values): self.filters.append(lambda row: row.get(key) in values); return self
    def lte(self, *_): return self
    def or_(self, *_): return self
    def single(self): self.as_single = True; return self
    def insert(self, values): self.operation, self.values = 'insert', values; return self
    def update(self, values): self.operation, self.values = 'update', values; return self
    def delete(self): self.operation = 'delete'; return self
    def upsert(self, values, on_conflict='id', ignore_duplicates=False):
        self.operation, self.values = 'upsert', values
        self.keys, self.ignore_duplicates = on_conflict.split(','), ignore_duplicates
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table_name, [])
        matched = [row for row in rows if row.get('user_id') == USER and all(check(row) for check in self.filters)]
        if self.operation in ('insert', 'upsert'):
            added = []
            for value in self.values if isinstance(self.values, list) else [self.values]:
                row = dict(value)
                existing = next((old for old in rows if all(old.get(key) == row.get(key) for key in getattr(self, 'keys', ['id']))), None)
                if existing and self.operation == 'upsert':
                    if not self.ignore_duplicates: existing.update(row)
                    continue
                row.setdefault('id', str(uuid.uuid4()))
                row.setdefault('created_at', datetime.now(timezone.utc).isoformat())
                if self.table_name == 'words':
                    for key, value in {'examples': [], 'collocations': [], 'synonyms': [], 'tags': [], 'mastery': 'Learning', 'review_count': 0}.items(): row.setdefault(key, value)
                rows.append(row); added.append(row)
            matched = added
        elif self.operation == 'update':
            for row in matched: row.update(self.values)
        elif self.operation == 'delete':
            for row in matched: rows.remove(row)
        if self.bounds: matched = matched[self.bounds[0]:self.bounds[1]]
        result = copy.deepcopy(matched)
        if self.table_name == 'words' and 'examples(' in getattr(self, 'fields', ''):
            for word in result:
                for table in ('examples', 'collocations', 'synonyms'):
                    word[table] = [copy.deepcopy(row) for row in self.db.tables.get(table, []) if row.get('word_id') == word['id']]
                word['tags'] = []
        return SimpleNamespace(data=result[0] if result and getattr(self, 'as_single', False) else result)


class Database:
    def __init__(self):
        self.tables = {'collections': [{'id': COLLECTION, 'user_id': USER, 'name': 'E2E test collection', 'description': '', 'created_at': '2026-11-01T12:00:00+00:00'}], 'words': [], 'imported_text': []}
        self.auth = SimpleNamespace(get_user=self.get_user)

    def get_user(self, token):
        if token != 'fixture-access-token': raise ValueError('Invalid fixture credential')
        return SimpleNamespace(user=SimpleNamespace(id=USER))

    def table(self, name): return Query(self, name)


def create_fixture_app():
    # Disable dotenv discovery before importing the real app; no remote credentials.
    import dotenv
    with patch.object(dotenv, 'load_dotenv'):
        from app import create_app
    import app as app_module
    import routes.vocabulary_management as management
    import routes.articles as articles
    import routes.file_import as file_import
    import routes.words as words
    import routes.collections as collections
    import routes.tags as tags
    import routes.review as review
    import routes.stats as stats
    import routes.export as export
    db = Database()
    import routes.exercises as exercises
    if os.getenv('VOCA_EXERCISE_POSTGRES')=='1':
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'utils'))
        from exercise_db import Database as ExerciseDatabase
        exercise_db=ExerciseDatabase()
        disposable=exercise_db.table('exercise_sets').select('*').eq('user_id',USER).execute().data
        ids={row['id'] for row in disposable if row['title'].startswith('E2E_TEST_EXERCISES_')}
        for session in exercise_db.table('exercise_sessions').select('*').eq('user_id',USER).execute().data:
            if session.get('config',{}).get('set_id') in ids:
                exercise_db.table('exercise_sessions').delete().eq('id',session['id']).eq('user_id',USER).execute()
        for id in ids:exercise_db.table('exercise_sets').delete().eq('id',id).eq('user_id',USER).execute()
        exercise_db.table('collections').upsert([{'id':COLLECTION,'user_id':USER,'name':'E2E test collection'}],on_conflict='id',ignore_duplicates=True).execute()
        exercises.get_supabase=lambda:exercise_db
    else:
        exercises.get_supabase=lambda:db
    management.get_supabase = app_module.get_supabase = articles.get_supabase = file_import.get_supabase = stats.get_supabase = review.get_supabase = export.get_supabase = lambda: db
    words.supabase = collections.supabase = tags.supabase = review.supabase = export.supabase = db
    app = create_app()
    app.config['TESTING'] = True
    ai_count = {'count': 0}
    from services import ai_service
    def forbidden_ai(*_, **__):
        ai_count['count'] += 1
        raise RuntimeError('AI provider disabled in isolated E2E fixture')
    ai_service.genai.GenerativeModel = forbidden_ai

    @app.get('/api/e2e-evidence')
    def evidence():
        return jsonify({'ai_calls': ai_count['count'], 'words': len(db.tables['words']), 'articles': len(db.tables['imported_text'])})

    auth = Flask('fixture-auth')
    CORS(auth)
    @auth.post('/v1/token')
    def sign_in():
        return jsonify({'access_token': 'fixture-access-token', 'token_type': 'bearer', 'expires_in': 3600,
                        'refresh_token': 'fixture-refresh-token',
                        'user': {'id': USER, 'aud': 'authenticated', 'role': 'authenticated', 'email': 'fixture@example.test', 'app_metadata': {}, 'user_metadata': {}}})
    @auth.get('/v1/user')
    def user(): return jsonify({'id': USER, 'aud': 'authenticated', 'email': 'fixture@example.test', 'app_metadata': {}, 'user_metadata': {}})
    return DispatcherMiddleware(app, {'/auth': auth})


if __name__ == '__main__':
    run_simple('127.0.0.1', 54399, create_fixture_app(), threaded=True, use_reloader=False)
