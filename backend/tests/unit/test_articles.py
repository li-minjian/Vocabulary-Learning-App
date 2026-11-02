import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, g
from routes.articles import articles_bp


class ArticleDB:
    def __init__(self):
        self.rows = []

    def table(self, name):
        assert name == 'imported_text'
        return ArticleQuery(self)


class ArticleQuery:
    def __init__(self, db):
        self.db, self.filters, self.value = db, {}, None

    def select(self, *_): return self
    def order(self, *_, **__): return self
    def limit(self, *_): return self
    def eq(self, key, value):
        self.filters[key] = value
        return self

    def upsert(self, value, **kwargs):
        assert kwargs['ignore_duplicates']
        self.value = value
        return self

    def execute(self):
        if self.value:
            if not any(row['id'] == self.value['id'] for row in self.db.rows):
                self.db.rows.append(self.value)
            return SimpleNamespace(data=[self.value])
        return SimpleNamespace(data=[row for row in self.db.rows if all(row.get(key) == value for key, value in self.filters.items())])


class ArticleTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config['TESTING'] = True
        @app.before_request
        def identity():
            from flask import request
            g.user_id = request.headers.get('X-Test-User', 'user-one')
        app.register_blueprint(articles_bp, url_prefix='/api/articles')
        self.client, self.db = app.test_client(), ArticleDB()

    def test_create_resume_isolation_and_no_ai(self):
        with patch('routes.articles.get_supabase', return_value=self.db), patch('google.generativeai.GenerativeModel') as ai:
            payload = {'title': 'Unicode', 'raw_text': 'Häuser, 中文.\nNext paragraph.', 'language': 'German'}
            created = self.client.post('/api/articles', json=payload)
            self.assertEqual(created.status_code, 201)
            retry = self.client.post('/api/articles', json=payload)
            self.assertEqual(retry.status_code, 200)
            self.assertEqual(created.json['id'], retry.json['id'])
            self.assertEqual(len(self.db.rows), 1)
            self.assertEqual(self.client.get('/api/articles').json['items'][0]['raw_text'], payload['raw_text'])
            path = '/api/articles/' + created.json['id']
            self.assertEqual(self.client.get(path).status_code, 200)
            self.assertEqual(self.client.get(path, headers={'X-Test-User': 'user-two'}).status_code, 404)
            self.assertEqual(self.client.get('/api/articles', headers={'X-Test-User': 'user-two'}).json['items'], [])
            ai.assert_not_called()

    def test_validation_and_persistence_failure(self):
        for data in (None, [], {}, {'raw_text': ''}, {'raw_text': 'x' * 100001}, {'raw_text': 'hello', 'title': 10}, {'raw_text': 'hello', 'language': 'invalid'}):
            self.assertEqual(self.client.post('/api/articles', json=data).status_code, 400)
        self.assertEqual(self.client.get('/api/articles/not-an-id').status_code, 400)
        with patch('routes.articles.get_supabase', side_effect=RuntimeError('private diagnostic')):
            response = self.client.post('/api/articles', json={'raw_text': 'Retain this draft'})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private diagnostic', response.text)


class AuthGateTests(unittest.TestCase):
    def test_real_application_auth_gate_protects_new_endpoints(self):
        from app import create_app
        app = create_app()
        app.config['TESTING'] = True
        client = app.test_client()
        for path in ('/api/articles', '/api/dictionary?q=hello', '/api/file-import/parse'):
            method = client.post if path.endswith('/parse') else client.get
            self.assertEqual(method(path).status_code, 401)
        self.assertEqual(client.get('/api/health').status_code, 200)
        for path in ('/api/uploads', '/api/uploads/'+'a'*32+'.csv/process'):
            self.assertEqual(client.post(path, json={}).status_code, 401)
        self.assertEqual(client.put('/api/uploads/'+'a'*32+'.csv/content', data=b'word').status_code, 401)
        self.assertEqual(client.delete('/api/uploads/'+'a'*32+'.csv').status_code, 401)
