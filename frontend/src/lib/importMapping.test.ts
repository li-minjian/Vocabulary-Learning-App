import test from 'node:test';
import assert from 'node:assert/strict';
import { cellValue, excludedFields, initialConfig, numericColumn, projectRow, representative, requiresConversion } from './importMapping.ts';
import type { ImportGroup, ParsedList } from './fileImport.ts';
const group: ImportGroup = { id:'model-1',name:'Cards',count:1,row_numbers:[8],fields:[{name:'Term',column:0},{name:'Meaning',column:1},{name:'Example',column:2}],templates:[],native_cards:2,analysis:{kind:'vocabulary',confidence:.9,reason:'evidence',mapping:{word:'0',translation:'1',examples:'2'},source_mapping:{},sample_rows:[8],fields:[],unresolved:[]} };
const parsed:ParsedList={import_id:'stable-id',columns:['Term','Meaning','Example'],rows:[['curious','好奇的','Curious people ask questions.']],row_numbers:[8],count:1,groups:[group],provenance:[{note_id:'123',group_id:'model-1',card_count:2}],warnings:[],invalid_rows:[],has_header:true};
test('one projection supplies live card values and final payload, with stable source note',()=>{
  const config=initialConfig(group);
  assert.equal(projectRow(parsed,group,config,8,'German').translation,'好奇的');
  config.mapping.translation='2';
  assert.equal(projectRow(parsed,group,config,8,'German').translation,'Curious people ask questions.');
  config.mapping.word='1'; config.mapping.examples='';
  const row=projectRow(parsed,group,config,8,'German');
  assert.equal(row.word,'好奇的');assert.equal(row.examples,'');assert.equal(row.language,'German');assert.equal(row.source_note_id,'123');
});
test('exercises stay preview-only and do not automatically choose an answer as word',()=>{
  const exercise={...group,analysis:{...group.analysis,kind:'grammar_exercise',mapping:{word:'',translation:'',examples:'2'}}};
  const config=initialConfig(exercise);
  assert.equal(config.enabled,false);assert.equal(config.conversion,false);assert.equal(config.mapping.word,'');assert.equal(requiresConversion(exercise),true);
});
test('canonical derived field is used without re-parsing cloze in the frontend',()=>{
  const source={...group,fields:[{name:'Question',column:0,canonical_column:1},{name:'Completed',column:1}]};
  assert.equal(cellValue(source,['It {{c1::works}}.','It works.'],'0'),'It works.');
});
test('numeric fields remain explicit and representative examples span the file',()=>{
  assert.equal(numericColumn([['1','hello'],['2','world']],'0'),true);
  assert.equal(numericColumn([['1','hello']],'1'),false);
  const sample=representative(Array.from({length:1000},(_,i)=>i));assert.equal(sample.length,100);assert.equal(sample[0],0);assert.equal(sample.at(-1),999);
});

test('excluded fields account for the origin of cloze-derived values',()=>{
 const source={...group,fields:[{name:'Id',column:0},{name:'Question',column:1},{name:'Cloze answer',column:2,derived:'cloze_answer',from_column:1}]};
 assert.deepEqual(excludedFields(source,{word:'2'}),['Id']);
});
