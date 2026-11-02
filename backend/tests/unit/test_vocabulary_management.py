"""Real isolated SQLite persistence, no live credentials, RLS or cascade assumptions."""
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from services.vocabulary_management import (BackupStore, CHILDREN, ManagementError, batch_delete, prepare_clear, clear_batch, restore_backup, read_rows, PHRASE)
from services.upload_store import LocalUploadStore
from services.file_import_service import commit_import, preview_import
from services.file_parser import parse_file
from test_file_import import apkg

USER, OTHER, COLLECTION = [str(uuid.uuid4()) for _ in range(3)]


class Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.orders, self.bounds = [], [], None
        self.op, self.values = 'select', None
    def select(self, fields='*'): self.fields = fields; return self
    def eq(self, key, value): self.filters.append((key, [value])); return self
    def in_(self, key, values): self.filters.append((key, values)); return self
    def order(self, key): self.orders.append(key); return self
    def range(self, start, end): self.bounds = (start, end); return self
    def upsert(self, values, **_): self.op, self.values = 'upsert', values; return self
    def delete(self): self.op = 'delete'; return self
    def update(self, values): self.op, self.values = 'update', values; return self
    def execute(self):
        if self.db.fail_table == self.name and self.op == 'delete': raise RuntimeError('simulated network failure')
        if self.op == 'upsert':
            for value in self.values:
                row = dict(value)
                if self.name != 'word_tags': row.setdefault('id', str(uuid.uuid4()))
                self.db.conn.execute(f'INSERT OR IGNORE INTO {self.name} VALUES (?,?,?,?,?)',
                    (row.get('id') or row.get('word_id') + ':' + row.get('tag_id'), row.get('user_id'), row.get('word_id'), row.get('tag_id'), json.dumps(row)))
            self.db.conn.commit()
        raw = self.db.conn.execute(f'SELECT id,data FROM {self.name}').fetchall()
        matched = [(key, json.loads(data)) for key, data in raw if all(json.loads(data).get(k) in vals for k, vals in self.filters)]
        for key in reversed(self.orders): matched.sort(key=lambda pair: str(pair[1].get(key)))
        if self.bounds: matched = matched[self.bounds[0]:self.bounds[1]+1]
        if self.op == 'update':
            for key, row in matched:
                row.update(self.values)
                self.db.conn.execute(f'UPDATE {self.name} SET data=? WHERE id=?', (json.dumps(row), key))
            self.db.conn.commit()
        if self.op == 'delete':
            for key, _ in matched: self.db.conn.execute(f'DELETE FROM {self.name} WHERE id=?', (key,))
            self.db.conn.commit()
        rows = [row for _, row in matched]
        if self.db.corrupt_read and self.name == 'words' and self.op == 'select':
            rows = [{**row, 'collection_id': None} for row in rows]
        return SimpleNamespace(data=rows)


class Database:
    def __init__(self, path):
        self.conn = sqlite3.connect(path)
        self.fail_table, self.corrupt_read = None, False
        for name in ('words', *CHILDREN, 'collections', 'imported_text', 'tags'):
            self.conn.execute(f'CREATE TABLE {name} (id TEXT PRIMARY KEY, user_id TEXT, word_id TEXT, tag_id TEXT, data TEXT)')
    def table(self, name): return Query(self, name)
    def add(self, table, values): self.table(table).upsert(values).execute()


class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(str(Path(self.tmp.name) / 'db.sqlite'))
        self.store = object.__new__(BackupStore)
        self.store.store = LocalUploadStore(Path(self.tmp.name) / 'private')
        self.word = str(uuid.uuid4()); self.foreign = str(uuid.uuid4())
        self.db.add('collections', [{'id': COLLECTION, 'user_id': USER, 'name': 'Keep folder'}])
        self.db.add('imported_text', [{'id': str(uuid.uuid4()), 'user_id': USER, 'raw_text': 'Preserve article'}])
        self.db.add('words', [{'id': self.word, 'user_id': USER, 'word': '13', 'collection_id': COLLECTION, 'review_count': 9, 'mastery': 'Familiar'}, {'id': self.foreign, 'user_id': OTHER, 'word': 'foreign'}])
        for table in CHILDREN:
            self.db.add(table, [{'id': str(uuid.uuid4()), 'user_id': USER, 'word_id': self.word, 'tag_id': str(uuid.uuid4()), 'value': 'original'}])
    def tearDown(self): self.db.conn.close(); self.tmp.cleanup()
    def test_private_backup_clear_and_exact_restore(self):
        before = {t: read_rows(self.db, USER, t) for t in ('words', *CHILDREN, 'collections', 'imported_text', 'tags')}
        backup = prepare_clear(self.db, USER, self.store)
        self.assertTrue(backup['verified']); self.assertEqual(backup['counts']['words'], 1)
        self.assertEqual(Path(backup['location']).stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ManagementError): clear_batch(self.db, USER, backup['backup_id'], 'DELETE', self.store)
        result = clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)
        self.assertEqual(result['removed'], 1); self.assertEqual(result['remaining'], 0); self.assertTrue(result['complete']); self.assertTrue(result['preserved'])
        self.assertEqual(len(read_rows(self.db, OTHER, 'words')), 1)
        self.assertTrue(clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)['complete'])
        self.assertTrue(restore_backup(self.db, USER, backup['backup_id'], 'RESTORE VOCABULARY', self.store)['verified'])
        for table, rows in before.items(): self.assertEqual(read_rows(self.db, USER, table), rows)
    def test_reject_foreign_and_invalid_ids_before_any_delete(self):
        for values in ([self.word, self.foreign], [self.word, 'invalid'], [self.word, self.word], [], [self.word]*201):
            with self.subTest(values=len(values)), self.assertRaises(ManagementError): batch_delete(self.db, USER, values, self.store)
        self.assertEqual(len(read_rows(self.db, USER, 'words')), 1)
        self.assertEqual(len(read_rows(self.db, USER, 'examples')), 1)
    def test_partial_batch_visible_and_retry(self):
        self.db.fail_table = 'synonyms'
        result = batch_delete(self.db, USER, [self.word], self.store)
        self.assertFalse(result['complete']); self.assertEqual(result['remaining_ids'], [self.word]); self.assertEqual(result['deleted'], 0)
        self.db.fail_table = None
        self.assertTrue(batch_delete(self.db, USER, [self.word], self.store)['complete'])
        for table in CHILDREN: self.assertFalse(read_rows(self.db, USER, table))
    def test_clear_partial_retry_and_stale_concurrent_import(self):
        backup = prepare_clear(self.db, USER, self.store)
        self.db.fail_table = 'words'
        result = clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)
        self.assertFalse(result['complete']); self.assertEqual(result['remaining'], 1)
        self.db.fail_table = None
        fresh = {'id': str(uuid.uuid4()), 'user_id': USER, 'word': 'new import'}
        self.db.add('words', [fresh])
        with self.assertRaisesRegex(ManagementError, 'changed after backup'): clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)
        self.assertEqual(len(read_rows(self.db, USER, 'words')), 2)
    def test_backup_tamper_and_other_owner_cannot_delete(self):
        backup = prepare_clear(self.db, USER, self.store)
        with self.assertRaises(ManagementError): clear_batch(self.db, OTHER, backup['backup_id'], PHRASE, self.store)
        path = Path(backup['location']); data = json.loads(path.read_text()); data['tables']['words'][0]['word'] = 'tampered'; path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ManagementError, 'checksum'): clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)
        self.assertEqual(len(read_rows(self.db, USER, 'words')), 1)
    def test_changed_article_preserved_without_deletion(self):
        backup = prepare_clear(self.db, USER, self.store)
        self.db.add('imported_text', [{'id': str(uuid.uuid4()), 'user_id': USER, 'raw_text': 'New article'}])
        with self.assertRaisesRegex(ManagementError, 'Articles'): clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)
        self.assertEqual(len(read_rows(self.db, USER, 'words')), 1)
    def test_import_real_persistence_numeric_mapping_and_destination(self):
        for separator, name in [(',', 'index.csv'), ('\t', 'index.tsv')]:
            parsed = parse_file(f'id{separator}word{separator}translation\n1{separator}hello{separator}你好\n2{separator}world{separator}世界'.encode(), name)
            self.assertEqual(parsed['columns'], ['id', 'word', 'translation'])
            request = {'import_id': name + '-test-id', 'language': 'English', 'collection_id': COLLECTION, 'rows': [{'row': i+2, 'word': row[1], 'translation': row[2]} for i,row in enumerate(parsed['rows'])]}
            result = commit_import(self.db, USER, request)
            self.assertEqual(result['failed'], 0)
            for row in read_rows(self.db, USER, 'words'):
                if row['word'] in ('hello','world'): self.assertEqual(row['collection_id'], COLLECTION)
            request['rows'] = [{'row': 2, 'word': '1'}]
            with self.assertRaisesRegex(ValueError, 'numbers'): preview_import(self.db, USER, request)
            request['allow_numeric'] = True
            self.assertEqual(preview_import(self.db, USER, request)['ready'], 1)
    def test_import_persisted_wrong_destination_is_failure(self):
        request = {'import_id': 'wrong-destination-test', 'language': 'English', 'collection_id': COLLECTION, 'rows': [{'row': 1, 'word': 'hello', 'translation': '你好'}]}
        self.db.corrupt_read = True
        result = commit_import(self.db, USER, request)
        self.assertEqual(result['imported'], 0); self.assertEqual(result['failed'], 1)
    def test_headerless_alias_preserved(self):
        for first in ('back','word','meaning'):
            result = parse_file(f'{first}\t回来\nhello\t你好'.encode(), 'noheader.tsv')
            self.assertFalse(result['has_header']); self.assertEqual(result['rows'][0][0], first)
    def test_anki_custom_order_and_metadata_collision_preserve_fields(self):
        parsed = parse_file(apkg(names=['Anki tags', 'Custom meaning', 'Word', 'Source deck'], values='original tags\x1ftranslation\x1fhello\x1foriginal source'), 'custom.apkg')
        values = dict(zip(parsed['columns'], parsed['rows'][0]))
        self.assertEqual(values['Anki tags'], 'original tags')
        self.assertEqual(values['Source deck'], 'original source')
        self.assertEqual(values['Word'], 'hello')
        self.assertEqual(values['Anki tags (metadata)'], 'German A1')
        directive = parse_file(b'#separator:tab\n#columns:ID\tMy term\tMy meaning\n1\thello\tworld', 'custom.txt')
        self.assertEqual(directive['columns'], ['ID', 'My term', 'My meaning'])
        self.assertEqual(directive['rows'][0], ['1','hello','world'])
    def test_repeated_anki_field_names_remain_distinct(self):
        parsed = parse_file(apkg(names=['Word','Word','Notes'], values='first\x1fsecond\x1fnotes'), 'repeat.apkg')
        self.assertEqual(parsed['rows'][0][:2], ['first','second'])
        self.assertNotEqual(parsed['columns'][0], parsed['columns'][1])
    def test_missing_live_relationship_blocks_deletion_without_admin_access(self):
        from unittest.mock import patch
        execute = Query.execute
        def fail_relationship(query):
            if 'word_tags(' in getattr(query, 'fields', ''):
                raise RuntimeError('PostgREST relation unavailable')
            return execute(query)
        with patch.object(Query, 'execute', fail_relationship):
            with self.assertRaisesRegex(ManagementError, 'relationships'): batch_delete(self.db, USER, [self.word], self.store)
        self.assertEqual(len(read_rows(self.db, USER, 'words')), 1)

    def test_authenticated_routes_and_single_word_ownership(self):
        from flask import Flask, g
        from unittest.mock import patch
        from routes.words import words_bp
        from routes.vocabulary_management import management_bp
        app = Flask(__name__)
        app.register_blueprint(words_bp, url_prefix='/api/words')
        app.register_blueprint(management_bp, url_prefix='/api/vocabulary-management')
        @app.before_request
        def fixture_identity():
            from flask import request
            if request.headers.get('X-Fixture-Identity') == 'owned': g.user_id = USER
        browser = app.test_client()
        headers = {'X-Fixture-Identity': 'owned'}
        with patch('routes.words.supabase', self.db), patch('routes.vocabulary_management.get_supabase', return_value=self.db), patch('routes.vocabulary_management.BackupStore', return_value=self.store), patch('services.vocabulary_management.BackupStore', return_value=self.store):
            self.assertEqual(browser.post('/api/vocabulary-management/clear/prepare').status_code, 401)
            self.assertEqual(browser.options('/api/vocabulary-management/batch-delete').status_code, 200)
            self.assertEqual(browser.get('/api/words/' + self.foreign, headers=headers).status_code, 404)
            self.assertEqual(browser.put('/api/words/' + self.foreign, headers=headers, json={'word': 'overwrite'}).status_code, 404)
            self.assertEqual(browser.delete('/api/words/' + self.foreign, headers=headers).status_code, 409)
            self.assertEqual(read_rows(self.db, OTHER, 'words')[0]['word'], 'foreign')
            backup = browser.post('/api/vocabulary-management/clear/prepare', headers=headers)
            self.assertEqual(backup.status_code, 201)
            backup_id = backup.json['backup_id']
            download = browser.get('/api/vocabulary-management/backups/' + backup_id, headers=headers)
            self.assertEqual(download.headers['Cache-Control'], 'no-store')
            self.assertEqual(len(download.json['tables']['words']), 1)
            response = browser.post('/api/vocabulary-management/clear', headers=headers, json={'backup_id': backup_id, 'confirmation': PHRASE})
            self.assertEqual(response.status_code, 200); self.assertTrue(response.json['complete'])
    def test_clear_multiple_bounded_batches(self):
        self.db.add('words', [{'id': str(uuid.uuid4()), 'user_id': USER, 'word': f'word {i}'} for i in range(230)])
        backup = prepare_clear(self.db, USER, self.store)
        result = clear_batch(self.db, USER, backup['backup_id'], PHRASE, self.store)
        self.assertTrue(result['complete']); self.assertEqual(result['removed'],231)

    def test_lock_blocks_parallel_operations(self):
        with self.store.lock(USER):
            with self.assertRaisesRegex(ManagementError, 'pending'): prepare_clear(self.db, USER, self.store)
        self.assertTrue(prepare_clear(self.db, USER, self.store)['verified'])

if __name__ == '__main__': unittest.main()
