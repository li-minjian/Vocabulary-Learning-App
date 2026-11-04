"""Reset only named synthetic Learn fixtures in the guarded disposable local DB."""
import json,sys,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'utils'))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from exercise_db import Database,USER
from services.import_semantics import interpret_note,content_hash
ns=uuid.UUID('cd67ed40-391f-498c-9002-df74486fd700')
ids={name:str(uuid.uuid5(ns,name)) for name in ['collection_a','collection_b','word_due','word_new','word_b','word_unassigned','set_a','set_b','set_unassigned','article']}
db=Database()
# All cleanup predicates name these fixture identities; no production targets permitted.
for session in db.table('exercise_sessions').select('*').eq('user_id',USER).execute().data:
 if session['config'].get('collection_id') in [ids['collection_a'],ids['collection_b']] or session['config'].get('set_id') in [ids['set_a'],ids['set_b'],ids['set_unassigned']]:
  db.table('exercise_sessions').delete().eq('id',session['id']).eq('user_id',USER).execute()
for name in ['set_a','set_b','set_unassigned']:db.table('exercise_sets').delete().eq('id',ids[name]).eq('user_id',USER).execute()
for name in ['word_due','word_new','word_b','word_unassigned']:db.table('words').delete().eq('id',ids[name]).eq('user_id',USER).execute()
for name in ['collection_a','collection_b']:db.table('collections').delete().eq('id',ids[name]).eq('user_id',USER).execute()
if '--clean' in sys.argv:
 db.table('imported_text').delete().eq('id',ids['article']).eq('user_id',USER).execute();db.conn.close();sys.exit(0)
for name,label in [('collection_a','LEARN_TEST_A'),('collection_b','LEARN_TEST_B')]:db.table('collections').insert({'id':ids[name],'user_id':USER,'name':label}).execute()
for name,word,collection,count in [('word_due','alpha',ids['collection_a'],1),('word_new','bravo',ids['collection_a'],0),('word_b','charlie',ids['collection_b'],1),('word_unassigned','delta',None,0)]:
 db.table('words').insert({'id':ids[name],'user_id':USER,'word':word,'translation':word+' meaning','language':'English','collection_id':collection,'review_count':count,'next_review':'2026-01-01T00:00:00Z' if count else None,'mastery':'Learning'}).execute()
for name,collection,due in [('set_a',ids['collection_a'],True),('set_b',ids['collection_b'],False),('set_unassigned',None,False)]:
 db.table('exercise_sets').insert({'id':ids[name],'user_id':USER,'title':'LEARN_TEST_'+name.upper(),'collection_id':collection}).execute()
 for n in range(2):
  note={'question':'One {{c1::plus}} two.','instruction':'Fill the blank','category':'Grammar','unit':f'Unit {n+1}','source_deck':'Learn fixture','source':{'note_id':name+str(n),'group_id':name,'cards':[{'id':name+str(n),'ordinal':0,'deck':'Learn fixture'}]},'kind':'grammar_exercise'}
  doc=interpret_note(note)[0]
  db.table('exercises').insert({'id':str(uuid.uuid5(ns,name+str(n))),'user_id':USER,'set_id':ids[name],'source_key':doc['source_key'],'content_hash':content_hash(doc),'position':n,'category':'Grammar','unit':f'Unit {n+1}','source_deck':'Learn fixture','document':doc,'total_attempts':1 if due else 0,'next_review':'2026-01-01T00:00:00Z' if due else None}).execute()
db.table('imported_text').upsert({'id':ids['article'],'user_id':USER,'title':'LEARN_TEST_ARTICLE','raw_text':'Hello world.','language':'English','source_type':'paste'},on_conflict='id').execute()
db.conn.close();print(json.dumps(ids))
