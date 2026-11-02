"""No live services: parse fixtures and persist into an isolated PostgREST fake."""
import io
import json
import sqlite3
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask, g
from services.file_parser import ImportValidationError, parse_file
from services.file_import_service import commit_import, preview_import
from routes.file_import import file_import_bp

USER = '11111111-1111-1111-1111-111111111111'
OTHER = '22222222-2222-2222-2222-222222222222'
COLLECTION = '33333333-3333-3333-3333-333333333333'


class FakeQuery:
    def __init__(self, db, name):
        self.db, self.name, self.filters = db, name, []
        self.values, self.bounds = None, None

    def select(self, value):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda row: row.get(key) in values)
        return self

    def order(self, key):
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def upsert(self, values, on_conflict, ignore_duplicates):
        assert ignore_duplicates is True, 'Imports must never update existing records.'
        self.values = values
        self.keys = on_conflict.split(',')
        return self

    def execute(self):
        if self.name == self.db.fail_table:
            raise RuntimeError('Simulated relation failure')
        table = self.db.tables.setdefault(self.name, [])
        if self.values is not None:
            if self.name == 'words':
                self.db.word_batches.append(len(self.values))
            created = []
            for value in self.values:
                if not any(all(row.get(key) == value.get(key) for key in self.keys) for row in table):
                    row = dict(value)
                    row.setdefault('id', str(uuid.uuid4()))
                    table.append(row)
                    created.append(row)
            return SimpleNamespace(data=created)
        rows = [row for row in table if all(check(row) for check in self.filters)]
        if self.bounds:
            rows = rows[self.bounds[0]:self.bounds[1] + 1]
        return SimpleNamespace(data=rows)


class FakeDB:
    def __init__(self):
        self.tables = {'words': [], 'collections': [{'id': COLLECTION, 'user_id': USER}]}
        self.fail_table = None
        self.word_batches = []

    def table(self, name):
        return FakeQuery(self, name)


def payload(rows=None, **kwargs):
    return {'import_id': 'test-stable-import-identity', 'language': 'English', 'collection_id': COLLECTION,
            'conflict': 'skip', 'rows': rows or [{'row': 1, 'word': 'curious', 'translation': '好奇的'}], **kwargs}


def apkg(compressed=False, modern=False, names=None, values=None):
    names = names or ['Word', 'Translation', 'Example']
    values = values or '<b>grüßen</b>\x1f问候<script>alert(1)</script>\x1fHallo<br>Welt'
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory) / 'deck.db'
        conn = sqlite3.connect(file)
        conn.execute('CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT)')
        conn.execute('CREATE TABLE cards (nid INTEGER, did INTEGER)')
        conn.execute('INSERT INTO notes VALUES (1, 1, ?, ?)', (values, 'German A1'))
        conn.execute('INSERT INTO cards VALUES (1, 5)')
        if modern:
            conn.execute('CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT)')
            conn.executemany('INSERT INTO fields VALUES (1, ?, ?)', list(enumerate(names)))
            conn.execute('CREATE TABLE decks (id INTEGER, name TEXT)')
            conn.execute("INSERT INTO decks VALUES (5, 'German::Greetings')")
        else:
            conn.execute('CREATE TABLE col (models TEXT, decks TEXT)')
            conn.execute('INSERT INTO col VALUES (?, ?)', (json.dumps({'1': {'flds': [{'name': name} for name in names]}}), json.dumps({'5': {'name': 'German::Greetings'}})))
        conn.commit()
        conn.close()
        content = file.read_bytes()
    if compressed:
        import zstandard
        content = zstandard.ZstdCompressor().compress(content)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('collection.anki21b' if compressed else 'collection.anki2', content)
        archive.writestr('media', '{}')
    return buffer.getvalue()


class ParserTests(unittest.TestCase):
    def test_csv_bom_unicode_quotes_multiline(self):
        parsed = parse_file('\ufeffword,translation,example\n"grüßen","问候","Hello,\nworld"\n'.encode(), 'words.csv')
        self.assertTrue(parsed['has_header'])
        self.assertEqual(parsed['rows'], [['grüßen', '问候', 'Hello,\nworld']])

    def test_delimiters_and_no_headers(self):
        for separator in ('\t', ';', '|'):
            with self.subTest(separator=separator):
                parsed = parse_file(f'Wörter{separator}单词\nHäuser{separator}房子'.encode(), 'words.txt', separator, False)
                self.assertEqual(parsed['rows'][1], ['Häuser', '房子'])
                self.assertEqual(len(parsed['columns']), 2)

    def test_missing_columns_report(self):
        parsed = parse_file(b'word,translation\nhello,hi\nworld\n', 'words.csv')
        self.assertEqual(parsed['invalid_rows'][0]['row'], 3)
        self.assertEqual(parsed['rows'][1], ['world'])

    def test_anki_text_directives(self):
        parsed = parse_file(b'#separator:tab\n#html:true\n#columns:Front\tBack\n<b>hello</b>\tworld\n', 'deck.txt')
        self.assertEqual(parsed['columns'], ['Front', 'Back'])
        self.assertEqual(parsed['rows'][0], ['hello', 'world'])
        self.assertTrue(parsed['warnings'])

    def test_legacy_apkg_html_and_deck(self):
        parsed = parse_file(apkg(), 'deck.apkg')
        row = dict(zip(parsed['columns'], parsed['rows'][0]))
        self.assertEqual(row['Word'], 'grüßen')
        self.assertEqual(row['Translation'], '问候')
        self.assertEqual(row['Example'], 'Hallo\nWelt')
        self.assertEqual(row['Source deck'], 'German::Greetings')
        self.assertEqual(row['Anki tags'], 'German A1')

    def test_modern_zstd_apkg(self):
        try:
            import zstandard  # noqa: F401
        except ImportError:
            self.skipTest('zstandard not installed')
        parsed = parse_file(apkg(compressed=True, modern=True), 'modern.apkg')
        self.assertEqual(parsed['rows'][0][0], 'grüßen')
        self.assertIn('Source deck', parsed['columns'])

    def test_reject_malformed_binary_and_oversize(self):
        for data, name in ((b'\xff\xfe', 'words.csv'), (b'a,\n"unclosed', 'words.csv'), (b'broken', 'deck.apkg'), (b'\x00', 'words.txt'), (b'x', 'words.exe')):
            with self.subTest(name=name, data=data):
                with self.assertRaises(ImportValidationError):
                    parse_file(data, name)
        with self.assertRaises(ImportValidationError):
            parse_file(b'x' * (50 * 1024 * 1024 + 1), 'words.csv')

    def test_apkg_database_budget_before_and_after_zstd_expansion(self):
        for compressed, modern in [(False, False), (True, True)]:
            with self.subTest(compressed=compressed), patch('services.file_parser.MAX_DATABASE_BYTES', 4096):
                with self.assertRaisesRegex(ImportValidationError, '100 MiB|database'):
                    parse_file(apkg(compressed=compressed, modern=modern), 'bounded.apkg')

    def test_reject_archive_traversal(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('../evil', 'x')
        with self.assertRaisesRegex(ImportValidationError, 'Unsafe'):
            parse_file(buffer.getvalue(), 'deck.apkg')


class ImportServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()

    def test_duplicate_skip_casefold_does_not_reset_srs(self):
        old = {'id': 'old', 'user_id': USER, 'word': ' Curious ', 'language': 'English', 'translation': 'personal', 'review_count': 8, 'mastery': 'Mastered'}
        self.db.tables['words'].append(old.copy())
        result = commit_import(self.db, USER, payload())
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(self.db.tables['words'], [old])

    def test_keep_both_and_idempotent_retry(self):
        request = payload(conflict='keep_both')
        self.db.tables['words'].append({'id': 'old', 'user_id': USER, 'word': 'curious', 'language': 'English'})
        first = commit_import(self.db, USER, request)
        second = commit_import(self.db, USER, request)
        self.assertEqual(first['imported'], 1)
        self.assertEqual(second['resumed'], 1)
        self.assertEqual(len(self.db.tables['words']), 2)
        self.assertEqual(self.db.tables['words'][1]['collection_id'], COLLECTION)

    def test_duplicate_within_file_and_other_user_isolation(self):
        self.db.tables['words'].append({'id': 'other', 'user_id': OTHER, 'word': 'curious', 'language': 'English'})
        request = payload([{'row': 1, 'word': 'curious'}, {'row': 2, 'word': 'CURIOUS'}])
        preview = preview_import(self.db, USER, request)
        self.assertEqual(preview['ready'], 1)
        self.assertEqual(preview['skipped'], 1)
        result = commit_import(self.db, USER, request)
        self.assertEqual(result['imported'], 1)
        self.assertEqual(self.db.tables['words'][0]['user_id'], OTHER)

    def test_foreign_collection_rejected_before_write(self):
        with self.assertRaisesRegex(ImportValidationError, 'belongs to another user'):
            commit_import(self.db, OTHER, payload())
        self.assertEqual(self.db.tables['words'], [])

    def test_invalid_rows_reported_without_rejecting_valid_rows(self):
        request = payload([{'row': 1, 'word': ''}, {'row': 2, 'word': 'hello', 'translation': '你好'}])
        result = commit_import(self.db, USER, request)
        self.assertEqual(result['invalid'], 1)
        self.assertEqual(result['imported'], 1)

    def test_invalid_row_identity_does_not_break_result_after_valid_write(self):
        request = payload([{'row': 'bad', 'word': 'hello'}, {'row': 2, 'word': 'world'}])
        result = commit_import(self.db, USER, request)
        self.assertEqual(result['invalid'], 1)
        self.assertEqual(result['imported'], 1)
        self.assertEqual(result['rows'][0]['row'], 1)

    def test_relations_failure_retry_repairs_without_duplicate_or_overwrite(self):
        request = payload([{'row': 1, 'word': 'hello', 'tags': 'a b', 'examples': 'Hello world'}])
        self.db.fail_table = 'examples'
        first = commit_import(self.db, USER, request)
        self.assertEqual(first['failed'], 1)
        self.assertTrue(first['rows'][0]['word_saved'])
        self.db.fail_table = None
        second = commit_import(self.db, USER, request)
        third = commit_import(self.db, USER, request)
        self.assertEqual(second['resumed'], 1)
        self.assertEqual(third['failed'], 0)
        self.assertEqual(len(self.db.tables['words']), 1)
        self.assertEqual(len(self.db.tables['examples']), 1)
        self.assertEqual(len(self.db.tables['tags']), 2)
        self.assertEqual(len(self.db.tables['word_tags']), 2)

    def test_per_row_language_override_default_and_duplicate_normalization(self):
        self.db.tables['words'].append({'id': 'old', 'user_id': USER, 'word': ' hallo ', 'language': '  GERMAN  '})
        request = payload([
            {'row': 1, 'word': 'hallo', 'language': ' German '},
            {'row': 2, 'word': 'hallo', 'language': 'English'},
            {'row': 3, 'word': 'hello', 'language': ''},
            {'row': 4, 'word': 'guten Tag', 'language': ' German '},
        ])
        result = commit_import(self.db, USER, request)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(result['imported'], 3)
        saved = {row['word']: row['language'] for row in self.db.tables['words'] if row['id'] != 'old'}
        self.assertEqual(saved['hello'], 'English')
        self.assertEqual(saved['hallo'], 'English')
        self.assertEqual(saved['guten Tag'], 'German')
        retried = commit_import(self.db, USER, request)
        self.assertEqual(retried['resumed'], 3)
        self.assertEqual(len(self.db.tables['words']), 4)

    def test_collocations_relation_failure_and_retry_without_duplicates(self):
        request = payload([{'row': 1, 'word': 'take', 'collocations': 'take action;take a break\ntake action'}])
        self.db.fail_table = 'collocations'
        first = commit_import(self.db, USER, request)
        self.assertEqual(first['failed'], 1)
        self.assertTrue(first['rows'][0]['word_saved'])
        self.db.fail_table = None
        second = commit_import(self.db, USER, request)
        third = commit_import(self.db, USER, request)
        self.assertEqual(second['resumed'], 1)
        self.assertEqual(third['resumed'], 1)
        self.assertEqual(len(self.db.tables['words']), 1)
        self.assertEqual([row['phrase'] for row in self.db.tables['collocations']], ['take action', 'take a break'])
        self.assertTrue(all(row['user_id'] == USER for row in self.db.tables['collocations']))

    def test_invalid_language_and_collocations_are_reported(self):
        request = payload([
            {'row': 1, 'word': 'hello', 'language': 123},
            {'row': 2, 'word': 'world', 'language': 'x' * 51},
            {'row': 3, 'word': 'take', 'collocations': {'bad': True}},
            {'row': 4, 'word': 'safe', 'collocations': ['safe choice']},
        ])
        result = commit_import(self.db, USER, request)
        self.assertEqual(result['invalid'], 3)
        self.assertEqual(result['imported'], 1)

    def test_1001_new_rows_bounded_batches_and_idempotent_retry_preserve_srs(self):
        existing = {'id': 'existing-srs', 'user_id': USER, 'word': 'known', 'language': 'English',
                    'translation': 'personal note', 'mastery': 'Mastered', 'review_count': 42,
                    'next_review': '2027-01-01T00:00:00Z'}
        self.db.tables['words'].append(existing.copy())
        rows = [{'row': 1, 'word': ' KNOWN ', 'translation': 'do not overwrite'}]
        rows.extend({'row': index + 2, 'word': f'word {index}', 'translation': f'词条 {index}'} for index in range(1001))
        request = payload(rows)
        first = commit_import(self.db, USER, request)
        self.assertEqual(first['imported'], 1001)
        self.assertEqual(first['skipped'], 1)
        self.assertEqual(first['failed'], 0)
        self.assertEqual(len(self.db.word_batches), 11)
        self.assertEqual(max(self.db.word_batches), 100)
        self.assertEqual(min(self.db.word_batches), 1)
        self.assertEqual(self.db.tables['words'][0], existing)
        retry = commit_import(self.db, USER, request)
        self.assertEqual(retry['resumed'], 1001)
        self.assertEqual(retry['skipped'], 1)
        self.assertEqual(retry['failed'], 0)
        self.assertEqual(len(self.db.tables['words']), 1002)
        self.assertEqual(self.db.tables['words'][0], existing)

    def test_payload_boundary_validation(self):
        for request in (None, {}, payload(conflict='overwrite'), payload(import_id='x'), payload(rows='bad')):
            with self.subTest(request=request):
                with self.assertRaises(ImportValidationError):
                    preview_import(self.db, USER, request)


class FileImportAPITests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        app = Flask(__name__)
        app.config['TESTING'] = True
        @app.before_request
        def test_request_identity():
            # Request-local fake identity, never installed in the application.
            from flask import request
            if request.headers.get('X-Test-User'):
                g.user_id = request.headers['X-Test-User']
        app.register_blueprint(file_import_bp, url_prefix='/api/file-import')
        self.client = app.test_client()

    def test_unauthenticated_rejected(self):
        self.assertEqual(self.client.post('/api/file-import/parse', json={'text': 'hi'}).status_code, 401)

    def test_cors_preflight_does_not_require_bearer(self):
        self.assertEqual(self.client.options('/api/file-import/parse', headers={
            'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        }).status_code, 200)

    def test_parse_preview_commit_zero_model_calls(self):
        with patch('google.generativeai.GenerativeModel') as model, patch('routes.file_import.get_supabase', return_value=self.db):
            headers = {'X-Test-User': USER}
            parsed = self.client.post('/api/file-import/parse', data={'file': (io.BytesIO('word,translation\nhello,你好'.encode()), 'vocab.csv')}, headers=headers)
            self.assertEqual(parsed.status_code, 200)
            request = payload([{'row': 2, 'word': 'hello', 'translation': '你好'}])
            self.assertEqual(self.client.post('/api/file-import/preview', json=request, headers=headers).status_code, 200)
            saved = self.client.post('/api/file-import/commit', json=request, headers=headers)
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json['imported'], 1)
            missing = self.client.post('/api/file-import/parse', json={'text': 'word,translation\nunknown,'}, headers=headers)
            self.assertEqual(missing.status_code, 200)
            invalid = self.client.post('/api/file-import/parse', json={'text': '"bad', 'filename': 'x.csv'}, headers=headers)
            self.assertEqual(invalid.status_code, 400)
            model.assert_not_called()

    def test_collection_isolation_http_400(self):
        with patch('routes.file_import.get_supabase', return_value=self.db):
            response = self.client.post('/api/file-import/commit', json=payload(), headers={'X-Test-User': OTHER})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(self.db.tables['words'], [])


if __name__ == '__main__':
    unittest.main()
