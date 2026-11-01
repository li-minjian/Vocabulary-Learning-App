import csv
import io
import unittest
from unittest.mock import patch

from flask import Flask, g
from routes.words import words_bp
from routes.stats import stats_bp
from routes.export import export_bp
from services.file_import_service import preview_import
from test_file_import import FakeDB, USER, OTHER, COLLECTION, payload


class LargeLibraryTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.tables['collections'][0]['name'] = 'Test collection'
        self.db.tables['words'] = [dict(id=f'word-{i:05d}', user_id=USER, word=f'known{i}', language='English',
            collection_id=COLLECTION, mastery='Learning', review_count=3,
            created_at='2026-11-01T12:00:00+00:00') for i in range(1001)]
        self.db.tables['words'].append(dict(id='foreign', user_id=OTHER, word='private', language='English'))
        app = Flask(__name__)
        app.config['TESTING'] = True
        @app.before_request
        def identity(): g.user_id = USER
        app.register_blueprint(words_bp, url_prefix='/api/words')
        app.register_blueprint(stats_bp, url_prefix='/api/stats')
        app.register_blueprint(export_bp, url_prefix='/api/export')
        self.client = app.test_client()

    def test_library_stats_and_exports_include_second_page_and_exclude_other_user(self):
        with patch('routes.words.supabase', self.db), patch('routes.stats.get_supabase', return_value=self.db), patch('routes.export.supabase', self.db):
            words = self.client.get('/api/words').json
            self.assertEqual(words['count'], 1001)
            self.assertEqual(words['items'][-1]['word'], 'known1000')
            self.assertEqual(self.client.get('/api/words?collection_id=other').json['count'], 0)
            self.assertEqual(self.client.get('/api/stats').json['total_words'], 1001)
            self.assertEqual(len(self.client.get('/api/export/vocabulary').json), 1001)
            self.assertEqual(len(self.client.get('/api/export/all').json['vocabulary']), 1001)
            self.assertEqual(len(self.client.get('/api/export/review-progress').json), 1001)
            response = self.client.get('/api/export/vocabulary?format=csv')
            rows = list(csv.reader(io.StringIO(response.data.decode('utf-8-sig'))))
            self.assertEqual(len(rows), 1002)
            self.assertEqual(rows[-1][0], 'known1000')

    def test_import_duplicate_check_reaches_beyond_first_page(self):
        result = preview_import(self.db, USER, payload(rows=[{'row': 1, 'word': 'known1000'}]))
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(result['ready'], 0)
