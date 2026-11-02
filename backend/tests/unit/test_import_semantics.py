"""Synthetic public fixtures; optional original APKG is read privately only."""
import io
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from services.file_parser import parse_file, ImportValidationError
from services.import_semantics import cloze_text
from services.file_import_service import commit_import, preview_import
from test_vocabulary_management import Database, USER, COLLECTION


def package(models, notes, cards=None):
    with tempfile.TemporaryDirectory() as folder:
        path=Path(folder)/'notes.db'; db=sqlite3.connect(path)
        db.executescript('CREATE TABLE col(models TEXT,decks TEXT);CREATE TABLE notes(id INTEGER,mid INTEGER,flds TEXT,tags TEXT);CREATE TABLE cards(nid INTEGER,did INTEGER);')
        db.execute('INSERT INTO col VALUES (?,?)',(json.dumps(models),json.dumps({'1':{'name':'Synthetic deck'}})))
        db.executemany('INSERT INTO notes VALUES (?,?,?,?)',[(nid,mid,'\x1f'.join(values),'synthetic') for nid,mid,values in notes])
        db.executemany('INSERT INTO cards VALUES (?,?)',cards if cards is not None else [(nid,1) for nid,_,_ in notes]);db.commit();db.close()
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as archive:archive.writestr('collection.anki2',path.read_bytes())
        return out.getvalue()


def model(name,fields,front,back,kind=0):
    return {'name':name,'type':kind,'flds':[{'name':name} for name in fields],
            'tmpls':[{'name':'Card','qfmt':front,'afmt':back}]}


def mapped_rows(parsed, group=None):
    group=group or parsed['groups'][0]; mapping=group['analysis']['mapping']; result=[]
    for number in group['row_numbers']:
        cells=parsed['rows'][parsed['row_numbers'].index(number)]
        row={key:cells[int(column)] for key,column in mapping.items() if column!=''}
        provenance=parsed['provenance'][parsed['row_numbers'].index(number)]
        row.update(row=number,source_kind=group['analysis']['kind'])
        if provenance:row.update(source_note_id=provenance['note_id'],source_group_id=provenance['group_id'])
        result.append(row)
    return result


class SemanticTests(unittest.TestCase):
    def test_standard_vocabulary_and_examples(self):
        p=parse_file(package({'1':model('Words',['Word','Translation','Example'],'{{Word}}','{{FrontSide}}{{Translation}}{{Example}}')},[(1,1,['abandon','放弃','He abandoned the plan.'])]),'words.apkg')
        g=p['groups'][0];self.assertEqual(g['analysis']['kind'],'vocabulary')
        self.assertEqual(mapped_rows(p)[0]['word'],'abandon');self.assertEqual(mapped_rows(p)[0]['translation'],'放弃')
        self.assertEqual(mapped_rows(p)[0]['examples'],'He abandoned the plan.')
        self.assertEqual(g['templates'][0]['front'][0]['field'],'Word')
    def test_custom_names_use_template_sides_and_content(self):
        m=model('Custom language cards',['Internal key','Lexical face','Native equivalent'],'{{Lexical face}}','{{FrontSide}}<div>{{Native equivalent}}</div>')
        p=parse_file(package({'7':m},[(1,7,['901','curious','好奇的']),(2,7,['902','greet','问候'])]),'custom.apkg')
        g=p['groups'][0];fields=g['analysis']['fields']
        self.assertEqual(fields[0]['role'],'identifier');self.assertEqual(g['analysis']['kind'],'vocabulary')
        self.assertEqual(g['analysis']['mapping']['word'],'1');self.assertEqual(g['analysis']['mapping']['translation'],'2')
        self.assertIn('template',fields[1]['reason'].lower()+g['analysis']['reason'].lower())
    def test_grammar_cloze_preserves_markers_and_answer_not_choices(self):
        m=model('Grammar exercises',['Id','Rubric','Question','Choices','Explanation'],'{{Rubric}}{{cloze:Question}}{{hint:Choices}}','{{cloze:Question}}{{Explanation}}',1)
        p=parse_file(package({'4':m},[(40,4,['123','Choose a preposition','She is interested {{c1::in::preposition}} learning German.','on / in / at','interested in + doing'])]),'grammar.apkg')
        g=p['groups'][0];self.assertEqual(g['analysis']['kind'],'grammar_exercise')
        self.assertEqual(g['analysis']['mapping']['word'],'');self.assertEqual(g['analysis']['mapping']['translation'],'')
        self.assertIn('{{c1::',p['rows'][0][2]);mapping=g['analysis']['source_mapping']
        self.assertEqual(p['rows'][0][mapping['question']],'She is interested [preposition] learning German.')
        self.assertEqual(p['rows'][0][mapping['answer']],'in');self.assertEqual(p['rows'][0][mapping['explanation']],'interested in + doing')
        self.assertEqual(g['analysis']['fields'][3]['role'],'choices')
    def test_multiple_native_cards_do_not_duplicate_notes(self):
        m=model('Cloze',['Text'],'{{cloze:Text}}','{{cloze:Text}}',1)
        m['tmpls'].append({'name':'Other','qfmt':'{{Text}}','afmt':'{{Text}}'})
        p=parse_file(package({'2':m},[(10,2,['{{c1::One}} plus {{c2::two}}'])],[(10,1),(10,1)]),'multi.apkg')
        self.assertEqual(p['count'],1);self.assertEqual(p['groups'][0]['native_cards'],2)
        self.assertEqual(p['provenance'][0]['note_id'],'10');self.assertEqual(p['provenance'][0]['cloze_indices'],[1,2])
        card=cloze_text(p['rows'][0][0]);self.assertEqual(card['answer'],'One; two');self.assertEqual(card['prompt'],'[…] plus […]')
    def test_mixed_note_types_have_independent_mapping(self):
        models={'1':model('Vocabulary',['Translation','Word'],'{{Word}}','{{Translation}}'),'2':model('Exercises',['Question','Answer','Explanation'],'{{Question}}','{{Answer}}{{Explanation}}')}
        p=parse_file(package(models,[(1,1,['放弃','abandon']),(2,2,['Choose a tense','present','An explanation'])]),'mixed.apkg')
        self.assertEqual(len(p['groups']),2);a,b=p['groups']
        self.assertEqual(a['analysis']['kind'],'vocabulary');self.assertEqual(mapped_rows(p,a)[0]['word'],'abandon')
        self.assertEqual(b['analysis']['kind'],'question_answer');self.assertEqual(b['analysis']['mapping']['word'],'')
        self.assertEqual(p['provenance'][1]['group_id'],'2')
    def test_translation_sentences_not_forced_into_words(self):
        p=parse_file(package({'1':model('Sentences',['Front','Back'],'{{Front}}','{{Back}}')},[(1,1,['This is a longer sentence for translating into another language.','这是一个句子的译文。'])]),'sentences.apkg')
        self.assertEqual(p['groups'][0]['analysis']['kind'],'translation_cards')
        self.assertEqual(p['groups'][0]['analysis']['mapping']['word'],'')
    def test_untrusted_html_and_scripts_are_not_renderable(self):
        m=model('Custom',['Word','Translation'],'<script>fetch("https://bad.invalid")</script>{{Word}}','{{Translation}}')
        p=parse_file(package({'1':m},[(1,1,['<b>safe</b><script>evil()</script><img src="https://bad.invalid/x">','安全'])]),'html.apkg')
        self.assertEqual(p['rows'][0][0],'safe');self.assertTrue(p['groups'][0]['templates'][0]['scripted'])
        self.assertNotIn('fetch(',json.dumps(p));self.assertTrue(p['provenance'][0]['has_media'])
    def test_csv_tsv_txt_and_uneven_rows_keep_working(self):
        for separator,name in [(',', 'words.csv'),('\t','words.tsv'),(';','words.txt')]:
            p=parse_file(f'Id{separator}Word{separator}Translation{separator}Example\n1{separator}curious{separator}好奇的{separator}An example\n2{separator}greet'.encode(),name,separator)
            g=p['groups'][0];self.assertEqual(g['analysis']['mapping']['word'],'1');self.assertEqual(g['analysis']['mapping']['translation'],'2')
            self.assertEqual(g['analysis']['fields'][0]['role'],'identifier');self.assertTrue(p['invalid_rows'])
        custom=parse_file(b'#separator:tab\n#columns:Prompt\tSolution\nquestion\tanswer','anki.txt')
        self.assertEqual(custom['groups'][0]['analysis']['kind'],'question_answer')
    def test_ambiguous_and_numeric_fields_not_auto_word(self):
        p=parse_file(b'Id,Unknown A,Unknown B\n1,alpha,beta\n2,gamma,delta','ambiguous.csv',has_header=True)
        self.assertEqual(p['groups'][0]['analysis']['mapping']['word'],'')
        self.assertEqual(p['groups'][0]['analysis']['mapping']['translation'],'')
    def test_samples_cover_file_and_missing_values(self):
        rows='Word,Translation\n'+'\n'.join(f'word{i},'+('' if i==11 else '翻译') for i in range(70))
        p=parse_file(rows.encode(),'samples.csv');samples=p['groups'][0]['analysis']['sample_rows']
        self.assertIn(p['row_numbers'][0],samples);self.assertIn(p['row_numbers'][-1],samples);self.assertIn(p['row_numbers'][11],samples)
    def test_reject_malformed_templates_without_executing(self):
        m=model('Bad',['Word'],'{{Word}}','{{Word}}');m['tmpls']='malformed'
        with self.assertRaises(ImportValidationError):parse_file(package({'1':m},[(1,1,['hello'])]),'bad.apkg')
    def test_nested_cloze_is_not_coerced(self):
        self.assertIsNone(cloze_text('{{c1::outer {{c2::inner}}}}'))
        request={'import_id':'nested-cloze-id','language':'English','rows':[{'row':1,'word':'{{c1::outer {{c2::inner}}}}','source_kind':'cloze_exercise','conversion_confirmed':True}]}
        with tempfile.TemporaryDirectory() as folder:
            db=Database(str(Path(folder)/'nested.sqlite'))
            self.assertEqual(preview_import(db,USER,request)['invalid'],1)
            self.assertEqual(commit_import(db,USER,request)['imported'],0)
            db.conn.close()

    @unittest.skipUnless(os.getenv('VOCA_PRIVATE_APKG'),'Private original is opt-in and never committed.')
    def test_original_exercises_privately(self):
        p=parse_file(Path(os.environ['VOCA_PRIVATE_APKG']).read_bytes(),'Exercises.apkg');g=p['groups'][0]
        self.assertEqual(p['count'],545);self.assertEqual(len(p['groups']),1);self.assertEqual(g['model_type'],1)
        self.assertEqual(g['native_cards'],545);self.assertEqual(g['analysis']['kind'],'grammar_exercise')
        roles={field['name']:field['role'] for field in g['analysis']['fields']}
        self.assertEqual(roles['Id'],'identifier');self.assertEqual(roles['Question'],'cloze_text');self.assertEqual(roles['Choices'],'choices')
        self.assertNotIn('explanation',g['analysis']['source_mapping']);self.assertEqual(g['analysis']['mapping']['word'],'')
        for row in p['rows']:
            card=cloze_text(row[p['columns'].index('Question')]);self.assertTrue(card is not None)
            self.assertTrue(row[g['analysis']['source_mapping']['answer']]==card['answer'])
            self.assertTrue(row[g['analysis']['source_mapping']['question']]==card['prompt'])


class SemanticPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=Database(str(Path(self.temp.name)/'test.sqlite'))
        self.db.add('collections',[{'id':COLLECTION,'user_id':USER,'name':'Synthetic'}])
    def tearDown(self):self.db.conn.close();self.temp.cleanup()
    def test_no_write_on_parse_or_preview_and_confirmed_rows_verified_in_batches(self):
        models={'1':model('Words',['Word','Translation','Example'],'{{Word}}','{{Translation}}{{Example}}')}
        p=parse_file(package(models,[(i,1,[f'word{i}','翻译',f'Sentence {i}.']) for i in range(1,152)]),'words.apkg')
        request={'import_id':'semantic-batch-stable','language':'English','collection_id':COLLECTION,'rows':mapped_rows(p)}
        self.assertEqual(len(self.db.table('words').select('*').execute().data),0)
        checked=preview_import(self.db,USER,request);self.assertEqual(checked['ready'],151)
        self.assertEqual(len(self.db.table('words').select('*').execute().data),0)
        for start in range(0,151,100):
            result=commit_import(self.db,USER,{**request,'rows':request['rows'][start:start+100]});self.assertEqual(result['failed'],0)
        saved=self.db.table('words').select('*').execute().data;self.assertEqual(len(saved),151)
        self.assertTrue(all(row['collection_id']==COLLECTION and row['translation']=='翻译' for row in saved))
        by_id={row['id']:row['word'] for row in saved}
        examples=self.db.table('examples').select('*').execute().data
        self.assertEqual(len(examples),151)
        self.assertTrue(all(row['sentence']==f"Sentence {by_id[row['word_id']][4:]}." for row in examples))
        self.assertEqual(len(self.db.table('tags').select('*').execute().data),1)
        self.assertEqual(len(self.db.table('word_tags').select('*').execute().data),151)
        self.assertEqual(commit_import(self.db,USER,request)['resumed'],151)
    def test_exercise_requires_explicit_conversion_and_numeric_still_guarded(self):
        row={'row':1,'word':'in','translation':'在','source_kind':'grammar_exercise','source_note_id':'1','source_group_id':'2'}
        request={'import_id':'exercise-test-id','language':'English','collection_id':COLLECTION,'rows':[row]}
        self.assertEqual(preview_import(self.db,USER,request)['invalid'],1)
        self.assertEqual(commit_import(self.db,USER,request)['imported'],0)
        row['conversion_confirmed']=True
        result=commit_import(self.db,USER,request);self.assertEqual(result['imported'],1);self.assertEqual(result['rows'][0]['source_note_id'],'1')
        row['word']='123'
        with self.assertRaises(ImportValidationError):preview_import(self.db,USER,request)

if __name__=='__main__':unittest.main()
