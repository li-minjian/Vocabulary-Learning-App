"""Real SQL/RLS verification in a disposable loopback database; never production."""
import os
import sys
import uuid
import unittest
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'utils'))
from exercise_db import Database, USER, OTHER
from services import exercise_service as exercise

def id(): return str(uuid.uuid4())

@unittest.skipUnless(os.getenv('VOCA_LEARN_POSTGRES')=='1','Requires the isolated full-schema database')
class LearningTest(unittest.TestCase):
 def setUp(self):
  self.db=Database();self.other=Database(OTHER);self.c=id();self.words=[];self.sets=[]
  self.db.table('collections').insert({'id':self.c,'user_id':USER,'name':'LEARN_UNIT_TEST'}).execute()
  self.unassigned=self.db.rpc('learning_summary',{'p_collection':'unassigned'}).execute().data['exercises']['total']
 def tearDown(self):
  for s in self.sets:self.db.table('exercise_sets').delete().eq('id',s).eq('user_id',USER).execute()
  for w in self.words:self.db.table('words').delete().eq('id',w).eq('user_id',USER).execute()
  self.db.table('collections').delete().eq('id',self.c).eq('user_id',USER).execute()
  self.db.conn.close();self.other.conn.close()
 def word(self,**kw):
  w=id();self.words.append(w);self.db.table('words').insert({'id':w,'user_id':USER,'word':'hello','language':'English','collection_id':self.c,**kw}).execute();return w
 def summary(self,**kw):return self.db.rpc('learning_summary',{'p_collection':self.c,**kw}).execute().data
 def record(self,w,session=None,**kw):
  return self.db.rpc('record_vocabulary_attempt',{'p_id':id(),'p_session':session or id(),'p_word':w,'p_mode':'review','p_format':'flashcard','p_rating':'good',**kw}).execute().data
 def seed_exercises(self,count=1):
  s=id();self.sets.append(s);self.db.table('exercise_sets').insert({'id':s,'user_id':USER,'collection_id':self.c,'title':'LEARN_UNIT_TEST'}).execute()
  rows=[{'id':id(),'user_id':USER,'set_id':s,'source_key':id(),'content_hash':'synthetic','position':n,'document':{'kind':'cloze'}} for n in range(count)]
  self.db.table('exercises').insert(rows).execute();return s,rows
 def test_545_new_exercises_are_not_due_and_available_for_practice(self):
  s,_=self.seed_exercises(545);summary=self.summary()['exercises'];self.assertEqual((summary['total'],summary['new'],summary['due']),(545,545,0))
  q=self.db.rpc('exercise_queue',{'p_collection':self.c,'p_set':s,'p_mode':'new','p_limit':200}).execute().data;self.assertEqual(len(q),200)
  sets=exercise.list_sets(self.db,USER);item=next(v for v in sets if v['id']==s);self.assertEqual((item['count'],item['completed'],item['due']),(545,0,0))
 def test_more_than_100_due_and_missing_timestamps(self):
  for _ in range(105):self.word(review_count=2,next_review='2026-01-01T01:00:00+02:00')
  self.word(review_count=1,next_review=None);self.word(review_count=0,next_review=None);self.word(review_count=2,next_review='2099-01-01T00:00:00Z')
  v=self.summary()['vocabulary'];self.assertEqual((v['due'],v['unscheduled'],v['new']),(106,1,1))
  q=self.db.rpc('vocabulary_queue',{'p_collection':self.c,'p_limit':200,'p_include_unscheduled':False}).execute().data;self.assertEqual(len(q),106)
 def test_practice_receipt_does_not_change_srs_or_invent_correctness(self):
  w=self.word(review_count=4,mastery='Familiar',next_review='2099-01-01T00:00:00Z');before=self.db.table('words').select('*').eq('id',w).execute().data[0]
  r=self.record(w,p_mode='practice');after=self.db.table('words').select('*').eq('id',w).execute().data[0];self.assertEqual(before,after);self.assertIsNone(r['correct'])
 def test_practice_changes_new_classification_only(self):
  w=self.word();self.assertEqual(self.summary()['vocabulary']['new'],1);self.record(w,p_mode='practice');v=self.summary()['vocabulary'];self.assertEqual((v['new'],v['unscheduled'],v['reviews']),(0,1,0))
 def test_retry_and_concurrent_submission_updates_srs_once(self):
  w=self.word();session=id()
  def submit(_):
   db=Database()
   try:return db.rpc('record_vocabulary_attempt',{'p_id':id(),'p_session':session,'p_word':w,'p_mode':'review','p_format':'spelling','p_rating':'good','p_response':'HELLO','p_revealed':False}).execute().data
   finally:db.conn.close()
  with ThreadPoolExecutor(4) as pool:r=list(pool.map(submit,range(4)))
  self.assertEqual(len({a['id'] for a in r}),1);self.assertTrue(r[0]['correct']);self.assertEqual(self.db.table('words').select('*').eq('id',w).execute().data[0]['review_count'],1)
 def test_wrong_objective_and_revealed_do_not_become_correct(self):
  self.record(self.word(),p_format='multipleChoice',p_response='wrong',p_revealed=False)
  self.record(self.word(),p_format='spelling',p_response=None,p_revealed=True)
  v=self.summary()['vocabulary'];self.assertEqual((v['correct'],v['incorrect'],v['self_assessed']),(0,1,1))
 def test_collection_and_user_isolation(self):
  w=self.word();self.seed_exercises();self.assertEqual(self.other.rpc('learning_summary',{}).execute().data['vocabulary']['total'],0)
  with self.assertRaises(Exception):self.other.rpc('learning_summary',{'p_collection':self.c}).execute()
  with self.assertRaises(Exception):self.other.rpc('record_vocabulary_attempt',{'p_id':id(),'p_session':id(),'p_word':w,'p_mode':'review','p_format':'flashcard','p_rating':'good'}).execute()
  self.assertEqual(self.db.rpc('learning_summary',{'p_collection':'unassigned'}).execute().data['exercises']['total'],self.unassigned)
 def test_mismatched_set_scope_cannot_start(self):
  s,_=self.seed_exercises()
  with self.assertRaises(Exception):exercise.start_session(self.db,USER,{'id':id(),'collection_id':'unassigned','set_id':s})
 def test_timezones_use_local_calendar_and_absolute_due_instants(self):
  w=self.word(review_count=1,next_review='2026-01-01T00:30:00+01:00',created_at='2026-01-01T00:30:00+01:00')
  with self.db.conn.cursor() as c:
   c.execute("select ('2026-01-01T00:30:00+01:00'::timestamptz at time zone 'Europe/Berlin')::date,('2026-01-01T00:30:00+01:00'::timestamptz at time zone 'UTC')::date")
   local,utc=c.fetchone();self.assertNotEqual(local,utc)
  a=self.summary(p_timezone='Europe/Berlin');b=self.summary(p_timezone='UTC');self.assertEqual(a['vocabulary']['due'],b['vocabulary']['due'])
 def test_local_calendar_aggregation_across_date_boundary(self):
  w=self.word()
  with self.db.conn.cursor() as c:
   c.execute("update words set created_at=((now() at time zone 'Pacific/Kiritimati')::date::timestamp+interval '5 minutes') at time zone 'Pacific/Kiritimati' where id=%s and user_id=auth.uid()",[w])
  self.db.conn.commit()
  self.assertEqual(self.summary(p_timezone='Pacific/Kiritimati')['vocabulary']['added_today'],1)
  self.assertEqual(self.summary(p_timezone='Pacific/Pago_Pago')['vocabulary']['added_today'],0)
 def test_exercise_new_due_future_and_null_classification(self):
  set_id,rows=self.seed_exercises(3)
  self.db.table('exercises').update({'total_attempts':1,'next_review':None}).eq('id',rows[0]['id']).execute()
  self.db.table('exercises').update({'total_attempts':1,'next_review':'2099-01-01T00:00:00Z'}).eq('id',rows[1]['id']).execute()
  e=self.summary()['exercises'];self.assertEqual((e['new'],e['due'],e['practiced']),(1,1,2))
  queue=self.db.rpc('exercise_queue',{'p_collection':self.c,'p_set':set_id,'p_mode':'due'}).execute().data;self.assertEqual(queue,[rows[0]['id']])
 def test_collection_deletion_detaches_exercise_without_losing_progress(self):
  set_id,rows=self.seed_exercises();self.db.table('exercises').update({'total_attempts':2,'next_review':'2099-01-01T00:00:00Z'}).eq('id',rows[0]['id']).execute()
  self.db.table('collections').delete().eq('id',self.c).eq('user_id',USER).execute()
  saved=self.db.table('exercise_sets').select('*').eq('id',set_id).execute().data[0];self.assertIsNone(saved['collection_id'])
  item=self.db.table('exercises').select('*').eq('id',rows[0]['id']).execute().data[0];self.assertEqual(item['total_attempts'],2)
 def test_private_backup_and_restore_preserves_receipts_and_srs(self):
  from services.vocabulary_management import BackupStore,prepare_clear,clear_batch,restore_backup,PHRASE
  w=self.word();receipt=self.record(w)
  with tempfile.TemporaryDirectory() as folder:
   from services.upload_store import LocalUploadStore
   store=object.__new__(BackupStore);store.store=LocalUploadStore(Path(folder))
   backup=prepare_clear(self.db,USER,store)
   result=clear_batch(self.db,USER,backup['backup_id'],PHRASE,store);self.assertTrue(result['complete'])
   restored=restore_backup(self.db,USER,backup['backup_id'],'RESTORE VOCABULARY',store);self.assertTrue(restored['verified'])
   rows=self.db.table('vocabulary_attempts').select('*').eq('id',receipt['id']).execute().data
   self.assertEqual(len(rows),1);self.assertEqual(self.db.table('words').select('*').eq('id',w).execute().data[0]['review_count'],1)
 def test_receipts_are_immutable_and_anonymous_execution_denied(self):
  w=self.word();r=self.record(w)
  with self.assertRaises(Exception):self.db.table('vocabulary_attempts').update({'rating':'easy'}).eq('id',r['id']).execute()
  with self.db.conn.cursor() as c:
   c.execute("select has_function_privilege('anon','public.learning_summary(text,uuid,text,text,text,text)','execute')")
   self.assertFalse(c.fetchone()[0])

if __name__=='__main__':unittest.main()
