import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root='/private/tmp/voca-semantic/browser-fixtures';
test.beforeAll(()=>{execFileSync(path.resolve('../backend/.venv/bin/python'),[path.resolve('../backend/tests/e2e/create_semantic_fixtures.py'),root]);});
async function signIn(page:Page){
  await page.goto('/login');
  await page.evaluate(async()=>{const modulePath='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */modulePath);const result=await supabase!.auth.signInWithPassword({email:'fixture@example.test',password:'public-fixture-value'});if(result.error)throw result.error;});
}
async function upload(page:Page,name:string){
  await page.goto('/import/files');await page.getByLabel('Vocabulary file').setInputFiles(path.join(root,name));
  if(name.endsWith('.apkg'))await expect(page.getByText('Text file options',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Analyze file',exact:true}).click();await expect(page.getByRole('heading',{name:/entries analyzed/})).toBeVisible();
}
async function change(page:Page,label:string,column:string){
  await page.getByRole('button',{name:`Change ${label} source`,exact:true}).click();await page.getByLabel(`${label} source`,{exact:true}).selectOption(column);
}

test('APKG interpretation, immediate live edits, final payload, collection and no AI or template requests',async({page})=>{
  const commits:any[]=[];let processing=0,ai=0,remote=0;
  page.on('request',r=>{if(r.url().endsWith('/api/file-import/commit'))commits.push(r.postDataJSON());if(/\/api\/(ai|import\/(analyze|extract-text))/.test(r.url()))ai++;if(r.url().includes('bad.invalid'))remote++;if(/\/api\/uploads\/[^/]+\/process$/.test(r.url()))processing++;});
  await signIn(page);await upload(page,'vocabulary.apkg');
  await expect(page.getByTestId('preview-word')).toHaveText('abandon');await expect(page.getByTestId('preview-translation')).toHaveText('放弃');await expect(page.getByTestId('preview-examples')).toHaveText('He abandoned the plan.');
  expect(commits).toHaveLength(0);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/private/tmp/voca-semantic/live-preview-synthetic.png',fullPage:true,animations:'disabled'});
  await change(page,'Translation','3');await expect(page.getByTestId('preview-translation')).toHaveText('To leave a plan behind.');
  await change(page,'Word / phrase','4');await expect(page.getByTestId('preview-word')).toHaveText('discard');
  await change(page,'Example','3');await expect(page.getByTestId('preview-examples')).toHaveText('To leave a plan behind.');
  await change(page,'Definition / notes','');await expect(page.getByTestId('preview-definition')).toHaveCount(0);
  await page.getByLabel('Create a collection (optional)',{exact:true}).fill('Semantic preview collection');
  await expect(page.getByRole('button',{name:'Check duplicates & preview'})).toBeDisabled();
  await page.getByRole('button',{name:'Create collection',exact:true}).click();await expect(page.getByLabel('Create a collection (optional)',{exact:true})).toHaveValue('');
  const collection=await page.getByLabel('Collection',{exact:true}).inputValue();
  await page.getByLabel('Default language',{exact:true}).selectOption('German');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/private/tmp/voca-semantic/live-edit-synthetic.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Check duplicates & preview'}).click();await expect(page.getByRole('heading',{name:'Review before importing'})).toBeVisible();
  await expect(page.getByTestId('preview-word')).toHaveText('discard');await expect(page.getByTestId('preview-translation')).toHaveText('To leave a plan behind.');expect(commits).toHaveLength(0);
  await page.getByRole('button',{name:'Back to preview & adjustments'}).click();await change(page,'Translation','1');
  await page.getByRole('button',{name:'Check duplicates & preview'}).click();await expect(page.getByTestId('preview-translation')).toHaveText('放弃');
  await page.getByRole('button',{name:'Confirm import',exact:true}).click();await expect(page.getByText('2 imported · 0 recovered / already saved · 0 skipped · 0 invalid · 0 failed')).toBeVisible();
  expect(commits[0].collection_id).toBe(collection);expect(commits[0].rows[0]).toMatchObject({word:'discard',translation:'放弃',examples:'To leave a plan behind.',language:'German',source_note_id:'101',source_group_id:'1'});
  expect(processing).toBe(1);expect(ai).toBe(0);expect(remote).toBe(0);
});

test('grammar cloze is preview-only, semantic correction is live, conversion is explicit',async({page})=>{
  let commits=0;page.on('request',r=>{if(r.url().endsWith('/api/file-import/commit'))commits++;});
  await signIn(page);await upload(page,'grammar.apkg');
  await expect(page.getByRole('heading',{name:'Grammar exercises',exact:true})).toBeVisible();
  await expect(page.getByTestId('source-question')).toHaveText('She is interested […] learning German.');await expect(page.getByTestId('source-answer')).toHaveText('in');await expect(page.getByTestId('source-explanation')).toHaveText('interested in + doing');
  await expect(page.getByRole('button',{name:'Check duplicates & preview'})).toBeDisabled();await expect(page.getByLabel('Include this group',{exact:true})).toBeDisabled();
  await change(page,'Answer / back','4');await expect(page.getByTestId('source-answer')).toHaveText('interested in + doing');
  await change(page,'Answer / back','8');await expect(page.getByTestId('source-answer')).toHaveText('in');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/private/tmp/voca-semantic/exercise-preview-synthetic.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Next example',exact:true}).click();await expect(page.getByTestId('source-answer')).toHaveText('One; two');await expect(page.getByText(/creates 2 Anki cards/)).toBeVisible();expect(commits).toBe(0);
  await page.getByRole('button',{name:'Previous example',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/private/tmp/voca-semantic/exercise-preview-mobile.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('I want to convert selected words or phrases into vocabulary and have checked what will be kept.',{exact:true}).check();
  await expect(page.getByRole('button',{name:'Check duplicates & preview'})).toBeDisabled();await change(page,'Word / phrase','8');
  await expect(page.getByTestId('preview-word')).toHaveText('in');await expect(page.getByTestId('preview-examples')).toHaveText('She is interested in learning German.');
  await page.getByRole('button',{name:'Check duplicates & preview'}).click();await expect(page.getByTestId('preview-word')).toHaveText('in');expect(commits).toBe(0);
  await page.getByRole('button',{name:'Confirm import',exact:true}).click();await expect(page.getByText('2 imported · 0 recovered / already saved · 0 skipped · 0 invalid · 0 failed')).toBeVisible();expect(commits).toBe(1);
});

test('mixed note types keep independent mappings and excluded exercise notes never enter payload',async({page})=>{
  let payload:any;page.on('request',r=>{if(r.url().endsWith('/api/file-import/commit'))payload=r.postDataJSON();});
  await signIn(page);await upload(page,'mixed.apkg');
  await change(page,'Word / phrase','4');await expect(page.getByTestId('preview-word')).toHaveText('discard');
  await page.getByRole('button',{name:/Grammar exercises.*2 entries/}).click();await expect(page.getByTestId('source-answer')).toHaveText('in');
  await expect(page.getByLabel('Include this group',{exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:/Vocabulary cards.*2 entries/}).click();await expect(page.getByTestId('preview-word')).toHaveText('discard');
  await page.getByLabel('Existing words',{exact:true}).selectOption('keep_both');
  await page.getByRole('button',{name:'Check duplicates & preview'}).click();await page.getByRole('button',{name:'Confirm import',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Import result',exact:true})).toBeVisible();
  expect(payload.rows).toHaveLength(2);expect(payload.rows.every((r:any)=>r.source_group_id==='1'&&r.source_kind==='vocabulary')).toBe(true);
});

test('mapping stays identical across 100-row batches and confirmation invalidates on destination changes',async({page})=>{
  const commits:any[]=[];await signIn(page);await upload(page,'large.csv');
  page.on('request',r=>{if(r.url().endsWith('/api/file-import/commit'))commits.push(r.postDataJSON());});
  let release:()=>void=()=>{};let requested:()=>void=()=>{};
  const requestArrived=new Promise<void>(resolve=>{requested=resolve;});
  const released=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/file-import/preview',async route=>{requested();await released;await route.continue();});
  await page.getByRole('button',{name:'Check duplicates & preview'}).click();await requestArrived;
  await page.getByLabel('Collection',{exact:true}).selectOption('33333333-3333-3333-3333-333333333333');release();
  await expect(page.getByRole('button',{name:'Check duplicates & preview'})).toBeEnabled();await expect(page.getByRole('heading',{name:'Review before importing'})).toBeHidden();await page.unroute('**/api/file-import/preview');
  await page.getByRole('button',{name:'Check duplicates & preview'}).click();await expect(page.getByText('Destination: E2E test collection',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Confirm import',exact:true}).click();await expect(page.getByText('151 imported · 0 recovered / already saved · 0 skipped · 0 invalid · 0 failed')).toBeVisible();
  expect(commits.map(p=>p.rows.length)).toEqual([100,51]);expect(commits.every(p=>p.collection_id==='33333333-3333-3333-3333-333333333333'&&p.import_id===commits[0].import_id)).toBe(true);
  expect(commits[1].rows[0]).toMatchObject({word:'batch-semantic-100',translation:'翻译100',examples:'Example 100.'});
  await page.setViewportSize({width:390,height:844});await page.goto('/import/files');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('hub actions look actionable and library has no duplicate Import Text or empty selection banner',async({page})=>{
  await signIn(page);await page.goto('/import');
  await expect(page.getByText('Ready',{exact:true})).toHaveCount(0);
  const file=page.getByRole('button',{name:'Upload vocabulary or Anki file →',exact:true});await expect(file).toBeVisible();await file.click();await expect(page).toHaveURL(/\/import\/files$/);
  await page.goto('/import');await page.getByRole('button',{name:'Paste text or upload a document',exact:true}).click();await expect(page).toHaveURL(/\/import\/step1$/);
  await page.goto('/vocabulary');await expect(page.getByRole('button',{name:'Import Text',exact:true})).toHaveCount(0);await expect(page.getByText('Selection resets when filters change.',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Vocabulary management',exact:true})).toBeVisible();
});
