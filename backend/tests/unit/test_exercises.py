"""Exercise semantics and opt-in real PostgreSQL/RLS lifecycle tests."""
import os, sys, unittest, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'utils'))
from services.import_semantics import interpret_note, check_answer, public_question
from services import exercise_service as s
from services.file_parser import parse_file

def note(question='She is interested {{c1::in::preposition}} learning German.', id='1'):
    return {'question': question, 'instruction': 'Complete the sentence', 'choices': 'on / in / at', 'category': 'Grammar', 'unit': 'Unit 1', 'source_deck': 'Synthetic', 'source': {'note_id': id, 'group_id': 'test-' + id, 'cards': [{'id': id, 'ordinal': 0, 'deck': 'Synthetic'}]}, 'position': 0, 'kind': 'grammar_exercise'}

class Semantics(unittest.TestCase):

    def test_blanks_hints_variants(self):
        n = note('{{c1::One}} plus {{c2::two::number}} equals {{c1::three}}.')
        n['source']['cards'].append({'id': '2', 'ordinal': 1})
        a, b = interpret_note(n)
        self.assertEqual(a['expected'], [['One'], ['three']])
        self.assertEqual(b['expected'], [['two']])
        self.assertEqual(b['blanks'][0]['hint'], 'number')
        self.assertEqual(a['question'], '_____ plus two equals _____.')
        self.assertEqual(b['question'], 'One plus _____ equals three.')
        self.assertTrue(check_answer(a, [' one ', 'THREE'])['correct'])
        self.assertFalse(check_answer(a, ['three', 'One'])['correct'])

    def test_no_answer_leak(self):
        d = interpret_note(note())[0]
        p = public_question({'id': 'x', 'set_id': 's', 'category': 'Grammar', 'unit': '1', 'source_deck': 'Synthetic', 'document': d})
        for key in ('expected', 'completed', 'original_question', 'blanks', 'explanation'):
            self.assertNotIn(key, p['document'])
        self.assertEqual(p['hints'], ['preposition'])
        self.assertIsNone(check_answer(d, [], True)['correct'])

    def test_options_and_self_assessment(self):
        n = note('Choose the preposition.')
        n.update(answer='in', choices='["at", "in", "on"]')
        d = interpret_note(n)[0]
        self.assertEqual(d['mode'], 'choice')
        self.assertTrue(check_answer(d, ['in'])['correct'])
        n['choices'] = 'at / in / on'
        d = interpret_note(n)[0]
        self.assertEqual(d['mode'], 'self_assess')
        self.assertIsNone(check_answer(d, ['in'])['correct'])

    def test_explicit_alternative_answers(self):
        n=note('Choose a greeting.')
        n.update(answer='["Hello", "Hi"]',choices='["Hello", "Hi", "Goodbye"]')
        d=interpret_note(n)[0]
        self.assertEqual(d['expected'],[['Hello','Hi']])
        self.assertTrue(check_answer(d,[' hi '])['correct'])
        self.assertFalse(check_answer(d,['hey'])['correct'])

    def test_unsupported(self):
        n=note();n['answer']='A different source'
        self.assertTrue(interpret_note(n)[0]['unsupported'])
        self.assertTrue(interpret_note(note('{{c1::outer {{c2::inner}}}}'))[0]['unsupported'])
        self.assertTrue(interpret_note(note('An unclear question'))[0]['unsupported'])

    def test_normalization(self):
        d = interpret_note(note('{{c1::café!}}'))[0]
        self.assertTrue(check_answer(d, [' CAFÉ! '])['correct'])
        self.assertFalse(check_answer(d, ['cafe'])['correct'])

@unittest.skipUnless(os.getenv('VOCA_EXERCISE_POSTGRES') == '1', 'Opt-in isolated PostgreSQL required.')
class Persistence(unittest.TestCase):

    def setUp(self):
        from exercise_db import Database, USER, OTHER
        self.user, self.other = (USER, OTHER)
        self.db = Database()
        self.foreign = Database(OTHER)
        self.sets = []
        self.sessions = []
        self.key = str(uuid.uuid4())

    def tearDown(self):
        for id in self.sessions:
            self.db.table('exercise_sessions').delete().eq('user_id', self.user).eq('id', id).execute()
        for id in self.sets:
            self.db.table('exercise_sets').delete().eq('user_id', self.user).eq('id', id).execute()
        self.db.conn.close()
        self.foreign.conn.close()

    def make_set(self):
        row = s.create_set(self.db, self.user, {'id': str(uuid.uuid4()), 'title': 'E2E_TEST_EXERCISES_' + self.key, 'source_filename': 'synthetic.apkg'})
        self.sets.append(row['id'])
        return row

    def imported(self, count=2):
        dest = self.make_set()
        p = s.prepare_import(self.db, self.user, {'notes': [note(id=self.key + '-' + str(i)) for i in range(count)]})
        for start in range(0, count, 100):
            self.assertEqual(s.commit_import(self.db, self.user, {'set_id': dest['id'], 'items': p['items'][start:start + 100]})['counts'].get('imported'), min(100, count - start))
        return (dest, p)

    def session(self, dest, mode='all'):
        id = str(uuid.uuid4())
        self.sessions.append(id)
        return s.start_session(self.db, self.user, {'id': id, 'set_id': dest['id'], 'limit': 20, 'mode': mode})

    def test_batches_reconnect_reimport(self):
        from exercise_db import Database
        dest, p = self.imported(151)
        db = Database()
        self.assertEqual(s.set_detail(db, self.user, dest['id'])['count'], 151)
        db.conn.close()
        self.assertEqual(s.one(self.db, 'exercises', self.user, p['items'][0]['id'])['document'], p['items'][0]['document'])
        self.assertEqual(s.commit_import(self.db, self.user, {'set_id': dest['id'], 'items': p['items'][:100]})['counts']['unchanged'], 100)

    def test_practice_reload_rate_due_reimport(self):
        dest, p = self.imported()
        r = self.session(dest)
        id = r['session']['id']
        e = r['current']['id']
        a = s.answer(self.db, self.user, id, {'id': str(uuid.uuid4()), 'exercise_id': e, 'answers': [' IN ']})
        self.assertTrue(a['correct'])
        self.assertIsNotNone(s.session_detail(self.db, self.user, id)['attempt'])
        again = s.answer(self.db, self.user, id, {'id': str(uuid.uuid4()), 'exercise_id': e, 'answers': ['wrong']})
        self.assertEqual(a['id'], again['id'])
        r = s.rate(self.db, self.user, id, {'exercise_id': e, 'rating': 'again'})
        self.assertEqual(r['session']['position'], 1)
        s.rate(self.db, self.user, id, {'exercise_id': e, 'rating': 'good'})
        saved = s.one(self.db, 'exercises', self.user, e)
        self.assertEqual(saved['total_attempts'], 1)
        self.assertEqual(saved['correct_attempts'], 1)
        self.assertTrue(saved['next_review'])
        s.commit_import(self.db, self.user, {'set_id': dest['id'], 'items': p['items']})
        self.assertEqual(s.one(self.db, 'exercises', self.user, e)['next_review'], saved['next_review'])
        self.db.table('exercises').update({'next_review': '2020-01-01T00:00:00Z'}).eq('id', e).execute()
        due = self.session(dest, 'due')
        self.assertEqual(due['current']['id'], e)
        a = s.answer(self.db, self.user, due['session']['id'], {'id': str(uuid.uuid4()), 'exercise_id': e, 'answers': ['wrong']})
        self.assertFalse(a['correct'])
        final = s.rate(self.db, self.user, due['session']['id'], {'exercise_id': e, 'rating': 'hard'})
        self.assertEqual(final['summary']['incorrect'], 1)

    def test_lost_commit_response_reconciles_without_duplicate(self):
        dest=self.make_set();prepared=s.prepare_import(self.db,self.user,{'notes':[note(id=self.key)]})
        original=self.db.table;failed=[False]
        def table(name):
            q=original(name);execute=q.execute
            def run():
                result=execute()
                if name=='exercises' and q.op=='upsert' and not failed[0]:
                    failed[0]=True
                    raise ConnectionError('Simulated lost response after commit')
                return result
            q.execute=run
            return q
        self.db.table=table
        result=s.commit_import(self.db,self.user,{'set_id':dest['id'],'items':prepared['items']})
        self.assertEqual(result['counts']['failed'],1)
        self.db.table=original
        result=s.commit_import(self.db,self.user,{'set_id':dest['id'],'items':prepared['items']})
        self.assertEqual(result['counts']['unchanged'],1)
        self.assertEqual(s.set_detail(self.db,self.user,dest['id'])['count'],1)

    def test_concurrent_rating_is_applied_once(self):
        from concurrent.futures import ThreadPoolExecutor
        from exercise_db import Database
        dest,_=self.imported(1);session=self.session(dest);id=session['session']['id'];exercise=session['current']['id']
        s.answer(self.db,self.user,id,{'id':str(uuid.uuid4()),'exercise_id':exercise,'answers':['in']})
        def submit(_):
            db=Database()
            try:return s.rate(db,self.user,id,{'exercise_id':exercise,'rating':'good'})['session']['position']
            finally:db.conn.close()
        with ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(submit,range(2)))
        self.assertEqual(result,[1,1]);self.assertEqual(s.one(self.db,'exercises',self.user,exercise)['total_attempts'],1)

    def test_reveal_skip_summary(self):
        dest, _ = self.imported()
        r = self.session(dest)
        id = r['session']['id']
        e = r['current']['id']
        a = s.answer(self.db, self.user, id, {'id': str(uuid.uuid4()), 'exercise_id': e, 'answers': [], 'revealed': True})
        self.assertIsNone(a['correct'])
        s.rate(self.db, self.user, id, {'exercise_id': e, 'rating': 'skip'})
        r = s.session_detail(self.db, self.user, id)
        e = r['current']['id']
        s.answer(self.db, self.user, id, {'id': str(uuid.uuid4()), 'exercise_id': e, 'answers': [], 'revealed': True})
        r = s.rate(self.db, self.user, id, {'exercise_id': e, 'rating': 'good'})
        self.assertEqual(r['session']['status'], 'finished')
        self.assertEqual(r['summary']['skipped'], 1)
        self.assertEqual(r['summary']['correct'], 0)
        self.assertIsNone(r['summary']['accuracy'])

    def test_cross_user_rls_and_collection(self):
        dest, p = self.imported(1)
        id = p['items'][0]['id']
        r = self.session(dest)
        for table, key in [('exercise_sets', dest['id']), ('exercises', id), ('exercise_sessions', r['session']['id'])]:
            self.assertFalse(self.foreign.table(table).select('*').eq('id', key).execute().data)
            self.assertFalse(self.foreign.table(table).delete().eq('id', key).execute().data)
        with self.assertRaises(Exception):
            self.foreign.table('exercises').insert({**s.one(self.db, 'exercises', self.user, id), 'id': str(uuid.uuid4())}).execute()
        with self.assertRaises(s.ExerciseError):
            s.one(self.foreign, 'exercise_sets', self.other, dest['id'])
        c = str(uuid.uuid4())
        self.foreign.table('collections').insert({'id': c, 'user_id': self.other, 'name': 'Foreign'}).execute()
        try:
            with self.assertRaises(Exception):
                self.db.table('exercise_sets').update({'collection_id': c}).eq('id', dest['id']).execute()
            with self.assertRaises(s.ExerciseError):
                s.create_set(self.db, self.user, {'id': str(uuid.uuid4()), 'title': 'Rejected', 'collection_id': c})
        finally:
            self.foreign.table('collections').delete().eq('id', c).execute()

    def test_media_needs_explicit_text_only_confirmation(self):
        n=note(id=self.key);n['source']['has_media']=True
        prepared=s.prepare_import(self.db,self.user,{'notes':[n]});dest=self.make_set()
        with self.assertRaises(s.ExerciseError):s.commit_import(self.db,self.user,{'set_id':dest['id'],'items':prepared['items']})
        self.assertEqual(s.set_detail(self.db,self.user,dest['id'])['count'],0)
        self.assertEqual(s.commit_import(self.db,self.user,{'set_id':dest['id'],'items':prepared['items'],'allow_text_only_media':True})['counts']['imported'],1)

    def test_conflict_no_overwrite(self):
        dest, p = self.imported(1)
        p['items'][0]['document']['original_question'] = 'Changed {{c1::at}} question.'
        with self.assertRaises(s.ExerciseError):
            s.commit_import(self.db, self.user, {'set_id': dest['id'], 'items': p['items']})
        n = note('Changed {{c1::at}} question.', self.key + '-0')
        changed = s.prepare_import(self.db, self.user, {'notes': [n]})
        self.assertEqual(changed['counts']['conflict'], 1)
        self.assertEqual(s.commit_import(self.db, self.user, {'set_id': dest['id'], 'items': changed['items']})['counts']['conflict'], 1)
        self.assertEqual(s.one(self.db, 'exercises', self.user, p['items'][0]['id'])['document']['expected'], [['in']])

    def test_deletion_relationships(self):
        dest, p = self.imported(1)
        c = str(uuid.uuid4())
        self.db.table('collections').insert({'id': c, 'user_id': self.user, 'name': 'Disposable'}).execute()
        self.db.table('exercise_sets').update({'collection_id': c}).eq('id', dest['id']).execute()
        self.db.table('collections').delete().eq('id', c).execute()
        self.assertIsNone(s.one(self.db, 'exercise_sets', self.user, dest['id'])['collection_id'])
        r = self.session(dest)
        e = r['current']['id']
        s.answer(self.db, self.user, r['session']['id'], {'id': str(uuid.uuid4()), 'exercise_id': e, 'answers': ['in']})
        self.db.table('exercises').delete().eq('id', e).execute()
        self.assertFalse(self.db.table('exercise_attempts').select('*').eq('exercise_id', e).execute().data)

    @unittest.skipUnless(os.getenv('VOCA_PRIVATE_APKG'), 'Private source opt-in only.')
    def test_original_545_roundtrip(self):
        p = parse_file(Path(os.environ['VOCA_PRIVATE_APKG']).read_bytes(), 'Exercises.apkg')
        g = p['groups'][0]
        sm = g['analysis']['source_mapping']
        fields = {f['name']: f['column'] for f in g['fields']}
        notes = []
        for i, row in enumerate(p['rows']):
            n = {k: row[c] for k, c in sm.items()}
            q = next((f for f in g['fields'] if f['column'] == sm['question']))
            n['question'] = row[q.get('from_column', q['column'])]
            n.update(category=row[fields['Category']], unit=row[fields['Unit']], source_deck=row[fields['Source deck']], source=p['provenance'][i], position=i, kind=g['analysis']['kind'])
            notes.append(n)
        preview = s.prepare_import(self.db, self.user, {'notes': notes})
        self.assertEqual(len(preview['items']), 545)
        self.assertTrue(all((not i['document']['unsupported'] for i in preview['items'])))
        dest = self.make_set()
        for start in range(0, 545, 100):
            self.assertTrue(s.commit_import(self.db, self.user, {'set_id': dest['id'], 'items': preview['items'][start:start + 100],'allow_text_only_media':True})['counts'].get('imported') == min(100, 545 - start))
        rows = s.pages(self.db, 'exercises', self.user, lambda q: q.eq('set_id', dest['id']))
        self.assertEqual(len(rows), 545)
        docs = {r['source_key']: r['document'] for r in rows}
        self.assertTrue(all((docs[i['document']['source_key']] == i['document'] for i in preview['items'])))
if __name__ == '__main__':
    unittest.main()
