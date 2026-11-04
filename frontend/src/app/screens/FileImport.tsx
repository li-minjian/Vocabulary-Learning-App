import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { validateFile, cancelUpload, type UploadProgress } from '../../lib/uploads';
import { createCollection, fetchCollections, type Collection } from '../../lib/api';
import { commitList, parseList, previewList, type ImportPayload, type ImportPreview, type ImportResult, type ParsedList } from '../../lib/fileImport';
import { excludedFields, initialConfig, kindLabels, numericColumn, projectRow, representative, requiresConversion, type GroupConfig } from '../../lib/importMapping';
import { ExerciseImport } from '../components/ExerciseImport';
import { SourceCard, VocabularyCard } from '../components/ImportCardPreview';

const inputStyle='w-full min-h-10 rounded-xl border border-border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600';
const buttonStyle='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#002434] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600';

export function FileImport() {
  const [stage,setStage]=useState<'upload'|'preview'|'confirm'|'result'>('upload');
  const [file,setFile]=useState<File|null>(null);
  const [text,setText]=useState('');
  const [delimiter,setDelimiter]=useState('');
  const [header,setHeader]=useState('auto');
  const [parsed,setParsed]=useState<ParsedList|null>(null);
  const [configs,setConfigs]=useState<Record<string,GroupConfig>>({});
  const [groupId,setGroupId]=useState('');
  const [example,setExample]=useState(0);
  const [selectedRows,setSelectedRows]=useState<Set<number>>(new Set());
  const [language,setLanguage]=useState('English');
  const [collections,setCollections]=useState<Collection[]>([]);
  const [collectionId,setCollectionId]=useState('');
  const [newCollection,setNewCollection]=useState('');
  const [collectionError,setCollectionError]=useState('');
  const [conflict,setConflict]=useState<'skip'|'keep_both'>('skip');
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [payload,setPayload]=useState<ImportPayload|null>(null);
  const [result,setResult]=useState<ImportResult|null>(null);
  const [confirmExample,setConfirmExample]=useState(0);
  const [activity,setActivity]=useState<'idle'|'working'|'exercise'>('idle');
  const busy=activity!=='idle';
  const setBusy=(value:boolean)=>setActivity(value?'working':'idle');
  const [error,setError]=useState('');
  const [progress,setProgress]=useState(0);
  const [uploadProgress,setUploadProgress]=useState<UploadProgress|null>(null);
  const controller=useRef<AbortController|null>(null);
  const revision=useRef(0);
  const positions=useMemo(()=>new Map(parsed?.row_numbers.map((number,index)=>[number,index])||[]),[parsed]);
  const group=parsed?.groups.find(group=>group.id===groupId);
  const config=group?configs[group.id]:undefined;
  const number=group?.row_numbers[Math.min(example,group.count-1)];
  const index=number===undefined?-1:positions.get(number)!;
  const cells=index<0?[]:parsed!.rows[index];
  const currentRow=parsed&&group&&config&&number!==undefined?projectRow(parsed,group,config,number,language,index):undefined;
  const activeGroups=useMemo(()=>parsed?.groups.filter(group=>configs[group.id]?.enabled&&group.row_numbers.some(number=>selectedRows.has(number)))||[],[parsed,configs,selectedRows]);
  const allRows=useMemo(()=>parsed?activeGroups.flatMap(group=>group.row_numbers.filter(n=>selectedRows.has(n)).map(n=>projectRow(parsed,group,configs[group.id],n,language,positions.get(n)))).sort((a,b)=>a.row-b.row):[],[parsed,activeGroups,configs,selectedRows,language,positions]);
  const numericGroups=activeGroups.filter(group=>numericColumn(group.row_numbers.filter(n=>selectedRows.has(n)).map(n=>parsed!.rows[positions.get(n)!]),configs[group.id].mapping.word));
  const invalidGroups=activeGroups.filter(group=>!configs[group.id].mapping.word||(requiresConversion(group)&&!configs[group.id].conversion));
  const canPreview=!!allRows.length&&!invalidGroups.length&&!newCollection.trim()&&!collectionError&&numericGroups.every(group=>configs[group.id].numeric);
  const destination=collectionId?collections.find(c=>c.id===collectionId)?.name||'Unavailable collection':'Library root';
  const isApkg=file?.name.toLowerCase().endsWith('.apkg');
  let fileValidation='';
  try { if(file)validateFile(file,'file'); } catch(cause){fileValidation=cause instanceof Error?cause.message:'Invalid file.';}

  useEffect(()=>{void loadCollections();},[]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function loadCollections(){try{setCollections(await fetchCollections());setCollectionError('');}catch{setCollectionError('Collections could not be loaded. Retry before choosing a destination.');}}
  function invalidate(){revision.current++;setPreview(null);setPayload(null);setError('');}
  function updateConfig(id:string,update:Partial<GroupConfig>){setConfigs(previous=>({...previous,[id]:{...previous[id],...update}}));invalidate();}
  async function parse(){
    setBusy(true);setError('');controller.current=new AbortController();
    try{
      const list=await parseList(file,text,isApkg?'':delimiter,isApkg?'auto':header,{signal:controller.current.signal,onProgress:setUploadProgress});
      if(!list.groups?.length)throw new Error('The interpretation service is unavailable. Reload and retry.');
      list.import_id=`${list.import_id.slice(0,64)}:${crypto.randomUUID()}`;
      setParsed(list);setConfigs(Object.fromEntries(list.groups.map(group=>[group.id,initialConfig(group)])));
      setGroupId(list.groups[0].id);setExample(0);setSelectedRows(new Set(list.row_numbers));setPreview(null);setPayload(null);setResult(null);setStage('preview');
    }catch(cause){setError(cause instanceof DOMException&&cause.name==='AbortError'?'Upload cancelled. You can retry.':cause instanceof Error?cause.message:'Unable to interpret this file.');}
    finally{setBusy(false);setUploadProgress(null);}
  }
  async function addCollection(){
    setBusy(true);setError('');
    try{
      const created=await createCollection({name:newCollection.trim()});
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(created.id))throw new Error('Collection creation was not confirmed. Retry before importing.');
      setCollections(previous=>[...previous,created]);setCollectionId(created.id);setNewCollection('');setPreview(null);setPayload(null);
    }catch(cause){setError(cause instanceof Error?cause.message:'Unable to create collection.');}finally{setBusy(false);}
  }
  async function checkPreview(){
    if(!parsed||!canPreview||busy)return;
    setBusy(true);setError('');
    try{
      const request:ImportPayload={import_id:parsed.import_id,rows:allRows,language,collection_id:collectionId||null,conflict,allow_numeric:numericGroups.length>0&&numericGroups.every(group=>configs[group.id].numeric)};
      const version=revision.current;
      const checked=await previewList(request);if(version!==revision.current)return;setPayload(request);setPreview(checked);setConfirmExample(0);setStage('confirm');
    }catch(cause){setError(cause instanceof Error?cause.message:'Unable to verify this import.');}finally{setBusy(false);}
  }
  async function save(){
    if(!payload||!preview?.ready||busy)return;
    setBusy(true);setError('');setProgress(0);
    const combined:ImportResult={import_id:payload.import_id,imported:0,resumed:0,skipped:0,invalid:0,failed:0,rows:[]};
    try{
      for(let start=0;start<payload.rows.length;start+=100){
        try{const part=await commitList({...payload,rows:payload.rows.slice(start,start+100)});combined.rows.push(...part.rows);}
        catch(cause){combined.rows.push(...payload.rows.slice(start).map(row=>({row:row.row,word:row.word,status:'failed' as const,message:'Persistence was not confirmed. Retry this same import to reconcile saved rows.'})));setError(cause instanceof Error?cause.message:'Connection interrupted.');break;}
        setProgress(Math.min(start+100,payload.rows.length));
      }
      for(const key of ['imported','resumed','skipped','invalid','failed'] as const)combined[key]=combined.rows.filter(row=>row.status===key).length;
      setResult(combined);setStage('result');
    }finally{setBusy(false);}
  }
  const confirmationRows=preview?.rows||[];
  const confirmationCard=confirmationRows[Math.min(confirmExample,confirmationRows.length-1)];
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <Link to="/import" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16}/> Back to Import</Link>
    <header className="border-b border-border pb-5"><h1 className="text-3xl font-bold tracking-tight text-[#002434]">File &amp; List Import</h1><p className="mt-2 text-sm text-muted-foreground">Upload → understand your cards → adjust the preview → choose a collection → import. No AI requests.</p></header>
    <ol aria-label="Import steps" className="flex flex-wrap gap-4 text-sm">{(['upload','preview','confirm','result'] as const).map((step,i)=><li key={step} aria-current={stage===step?'step':undefined} className={stage===step?'font-bold text-teal-700':'text-muted-foreground'}>{i+1}. {{upload:'Upload',preview:'Interpret & preview',confirm:'Confirm',result:'Result'}[step]}</li>)}</ol>
    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {stage==='upload'&&<section className="space-y-5 rounded-2xl border border-border bg-card p-6">
      <div><label htmlFor="voca-file" className="mb-2 block text-sm font-semibold">Vocabulary file (up to 50 MiB)</label><input id="voca-file" type="file" accept=".csv,.tsv,.txt,.apkg" className={inputStyle} disabled={busy} onChange={event=>{setFile(event.target.files?.[0]||null);setError('');}}/><p className="mt-2 text-xs text-muted-foreground">CSV, TSV, Anki TXT or APKG. VOCA reads the available structure automatically. Media and scheduling are not imported.</p></div>
      {!file&&<div><label htmlFor="voca-pasted-list" className="mb-2 block text-sm font-semibold">Or paste a vocabulary list</label><textarea id="voca-pasted-list" className={`${inputStyle} font-mono`} rows={6} placeholder={'Word\tTranslation\ncurious\t好奇的'} value={text} disabled={busy} onChange={event=>setText(event.target.value)}/></div>}
      {!isApkg&&<details className="text-sm"><summary className="cursor-pointer font-semibold">Text file options</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><label>Delimiter<select aria-label="Delimiter" className={inputStyle} value={delimiter} onChange={event=>setDelimiter(event.target.value)}><option value="">Detect automatically</option><option value=",">Comma</option><option value={'\t'}>Tab</option><option value=";">Semicolon</option><option value="|">Pipe</option></select></label><label>First row<select aria-label="First row" className={inputStyle} value={header} onChange={event=>setHeader(event.target.value)}><option value="auto">Detect headers</option><option value="true">Column headers</option><option value="false">Vocabulary data (no header)</option></select></label></div></details>}
      <button className={buttonStyle} disabled={busy||(!file&&!text.trim())||!!fileValidation} onClick={parse}>{busy?<Loader2 className="animate-spin" size={16}/>:<FileUp size={16}/>} Analyze file</button>
      {fileValidation&&<p role="alert" className="text-sm text-red-700">{fileValidation}</p>}
      {uploadProgress&&<div role="status"><p className="text-sm">{uploadProgress.stage==='processing'?'Reading structure and interpreting cards…':`${uploadProgress.stage} ${uploadProgress.percent}%`}</p><progress className="w-full" max={100} value={uploadProgress.percent}/><button className="mt-2 text-sm underline" onClick={()=>{controller.current?.abort();if(file)void cancelUpload(file).catch(()=>{});}}>Cancel upload</button></div>}
    </section>}
    {parsed&&group&&config&&stage==='preview'&&<>
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-5"><h2 className="text-xl font-bold">{file?.name||'Your list'} · {parsed.count.toLocaleString()} entries analyzed</h2><p className="mt-2 text-sm">{parsed.groups.length} content {parsed.groups.length===1?'group':'groups'} · {allRows.length} entries included for vocabulary · {parsed.count-allRows.length} entries not included in Vocabulary.</p><p className="mt-1 text-sm font-semibold">No vocabulary records have been created.</p></section>
      <div className="flex flex-wrap gap-2" aria-label="Content groups">{parsed.groups.map(g=><button key={g.id} disabled={busy} onClick={()=>{setGroupId(g.id);setExample(0);}} aria-pressed={g.id===groupId} className={`min-h-11 rounded-xl border px-4 py-2 text-left text-sm ${g.id===groupId?'border-teal-700 bg-teal-50':'bg-white'}`}><strong>{kindLabels[g.analysis.kind]}</strong><span className="ml-2 text-muted-foreground">{g.count} entries</span>{parsed.groups.length>1&&<span className="mt-1 block text-xs">{g.name}</span>}</button>)}</div>
      <section className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{kindLabels[group.analysis.kind]}</h2><p className="mt-1 text-sm text-muted-foreground">{group.analysis.confidence>=.85?'High-confidence suggestion':'Please check this interpretation'} · {group.analysis.reason}</p></div><label className="text-sm font-semibold"><input type="checkbox" checked={config.enabled} disabled={busy||(requiresConversion(group)&&!config.conversion)} onChange={event=>updateConfig(group.id,{enabled:event.target.checked})}/> Include this group</label></div>
        {requiresConversion(group)&&<div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p><strong>Exercise content.</strong> Use Save as Exercises below to keep these as study cards. Converting selected words or phrases into Vocabulary is a separate, optional action.</p><label className="block font-semibold"><input type="checkbox" disabled={busy} checked={config.conversion} onChange={event=>updateConfig(group.id,{conversion:event.target.checked,enabled:event.target.checked})}/> I want to convert selected words or phrases into vocabulary and have checked what will be kept.</label></div>}
        {group.warnings?.map((warning,i)=><p key={i} role="alert" className="text-sm text-amber-900">{warning}</p>)}
        {!!group.analysis.unresolved.length&&<p className="text-sm text-amber-900">Unresolved fields: {group.analysis.unresolved.join(', ')}. Suggestions for other fields remain available.</p>}
        <fieldset disabled={busy} className={`grid min-w-0 gap-5 disabled:opacity-70 ${requiresConversion(group)&&config.conversion?'lg:grid-cols-2':'mx-auto w-full max-w-3xl'}`}>
          {requiresConversion(group)&&<SourceCard key={`source-${group.id}`} group={group} config={config} cells={cells} onChange={sourceMapping=>updateConfig(group.id,{sourceMapping})}/>}
          {(!requiresConversion(group)||config.conversion)&&currentRow&&<VocabularyCard key={`vocabulary-${group.id}`} row={currentRow} group={group} config={config} cells={cells} onChange={mapping=>updateConfig(group.id,{mapping,numeric:false})}/>}
        </fieldset>
        {config.enabled&&!config.mapping.word&&<p role="alert" className="text-sm font-semibold text-amber-900">Choose the Word source on the preview card before continuing.</p>}
        {config.enabled&&numericGroups.some(g=>g.id===group.id)&&<label className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={config.numeric} onChange={event=>updateConfig(group.id,{numeric:event.target.checked})}/> This Word source contains numbers and may be an index or ID. I have checked it and want to import numerical vocabulary.</label>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><button className="min-h-10 rounded-lg border px-3" disabled={example===0} onClick={()=>setExample(value=>value-1)}>Previous example</button><span>Example {example+1} of {group.count}</span><button className="min-h-10 rounded-lg border px-3" disabled={example+1>=group.count} onClick={()=>setExample(value=>value+1)}>Next example</button></div>
        <div className="flex flex-wrap gap-2">{group.analysis.sample_rows.map((n,i)=><button key={n} className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs" onClick={()=>setExample(group.row_numbers.indexOf(n))}>Sample {i+1}</button>)}</div>
        {number!==undefined&&config.enabled&&<label className="block text-sm"><input type="checkbox" checked={selectedRows.has(number)} onChange={event=>{setSelectedRows(previous=>{const next=new Set(previous);if(event.target.checked)next.add(number);else next.delete(number);return next;});invalidate();}}/> Include this entry</label>}
        {parsed.provenance[index]?.card_count&&parsed.provenance[index].card_count!>1?<p className="text-xs text-muted-foreground">This note creates {parsed.provenance[index].card_count} Anki cards. VOCA previews its combined text and creates at most one vocabulary record per source note.</p>:null}
        {!config.enabled?<p className="text-xs text-muted-foreground">This group is not included in Vocabulary. Use Save as Exercises below to save study cards.</p>:<p className="text-xs text-muted-foreground">Excluded from the proposed vocabulary: {excludedFields(group,config.mapping).join(', ')||'None'}.</p>}
        <details className="rounded-xl border bg-white p-4 text-sm"><summary className="cursor-pointer font-semibold">Advanced: field evidence &amp; source details</summary><div className="mt-3 space-y-3"><p>Note type: {group.name} · ID: {group.id} · {group.native_cards} native cards · source note: {parsed.provenance[index]?.note_id||'text row'} · source row: {number}</p><p>Templates: {group.templates.length?group.templates.map(t=>`${t.name}: front ${t.front.map(r=>r.field).join(', ')} / back ${t.back.map(r=>r.field).join(', ')}${t.scripted?' (script omitted)':''}`).join('; '):'Template metadata unavailable; interpretation uses field content.'}</p><div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Source field</th><th className="p-2">Role</th><th className="p-2">Confidence &amp; evidence</th></tr></thead><tbody>{group.analysis.fields.map(field=><tr key={field.column} className="border-t"><td className="p-2">{field.column+1}. {field.name}</td><td className="p-2">{field.role}</td><td className="p-2">{Math.round(field.confidence*100)}% · {field.reason} {field.evidence.sampled_nonempty}/{field.evidence.sample_size} sampled values nonempty.</td></tr>)}</tbody></table></div><div className="grid gap-2">{group.fields.filter(f=>!f.derived).map(field=><div key={field.column}><strong>{field.name}: </strong><span className="whitespace-pre-wrap break-words">{cells[field.column]||'(empty)'}</span></div>)}</div><div className="flex flex-wrap gap-3"><button disabled={busy} className="underline" onClick={()=>{setSelectedRows(previous=>new Set([...previous,...group.row_numbers]));invalidate();}}>Select all entries in this group</button><button disabled={busy} className="underline" onClick={()=>{setSelectedRows(previous=>new Set([...previous].filter(n=>!group.row_numbers.includes(n))));invalidate();}}>Deselect this group's entries</button></div></div></details>
      </section>
      {parsed.groups.some(g=>requiresConversion(g))&&<ExerciseImport parsed={parsed} configs={configs} selected={selectedRows} filename={file?.name||'Your list'} collectionId={collectionId} destinationBlocked={!!newCollection.trim()||!!collectionError} onSaving={value=>setActivity(value?'exercise':'idle')}/> }
      <section className="space-y-4 rounded-2xl border border-border bg-white p-6"><h2 className="text-lg font-bold">Collection &amp; duplicate handling</h2><div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-semibold">Default language<select disabled={activity==='exercise'} aria-label="Default language" className={inputStyle} value={language} onChange={event=>{setLanguage(event.target.value);invalidate();}}>{['English','German','French','Spanish','Japanese','Chinese'].map(v=><option key={v}>{v}</option>)}</select></label><label className="text-sm font-semibold">Collection<select disabled={activity==='exercise'} aria-label="Collection" className={inputStyle} value={collectionId} onChange={event=>{setCollectionId(event.target.value);invalidate();}}><option value="">Library root</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-sm font-semibold">Existing words<select disabled={activity==='exercise'} aria-label="Existing words" className={inputStyle} value={conflict} onChange={event=>{setConflict(event.target.value as 'skip'|'keep_both');invalidate();}}><option value="skip">Skip duplicates</option><option value="keep_both">Keep both as separate words</option></select></label></div><div className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-sm font-semibold">Create a collection (optional)<input disabled={activity==='exercise'} aria-label="Create a collection (optional)" className={inputStyle} value={newCollection} maxLength={255} onChange={event=>{setNewCollection(event.target.value);invalidate();}}/></label><button className={buttonStyle} disabled={busy||!newCollection.trim()} onClick={addCollection}>Create collection</button></div>
        {newCollection.trim()&&<p role="alert" className="text-sm text-amber-900">Create this collection successfully or clear its name before continuing.</p>}{collectionError&&<p role="alert" className="text-sm text-red-700">{collectionError} <button className="underline" onClick={loadCollections}>Retry collections</button></p>}<p className="font-semibold">Destination: {destination}</p><p className="text-xs text-muted-foreground">Duplicates are checked across all Collections. Skip preserves existing locations and SRS; Keep both creates new records in this destination. Word: 500 characters; other fields: 20,000 characters; up to 10,000 entries.</p>
      </section>
      {parsed.warnings.map((warning,i)=><p key={i} className="text-xs text-muted-foreground">{warning}</p>)}{!!parsed.invalid_rows.length&&<p className="text-sm text-amber-900">{parsed.invalid_rows.length} rows have uneven field counts. Check the corresponding examples; missing cells remain blank.</p>}
      <div className="flex flex-wrap justify-between gap-3"><button className="text-sm underline" disabled={busy} onClick={()=>setStage('upload')}>Change source</button><button className={buttonStyle} disabled={busy||!canPreview} onClick={checkPreview}>{busy&&<Loader2 size={16} className="animate-spin"/>} Check duplicates &amp; preview</button></div>
      {!!invalidGroups.length&&<p className="text-sm text-amber-900">Resolve Word for each included group, or exclude that group. Exercise groups remain preview-only without explicit conversion.</p>}
    </>}
    {stage==='confirm'&&preview&&<section className="space-y-5"><div className="rounded-2xl border bg-teal-50 p-5"><h2 className="text-xl font-bold">Review before importing</h2><p className="mt-2 font-semibold">Destination: {destination}</p><p className="mt-1 text-sm">{preview.ready} ready · {preview.skipped} duplicates skipped · {preview.invalid} invalid rows</p><p className="mt-1 text-sm">{payload?.rows.length} proposed entries · {parsed!.count-payload!.rows.length} excluded / preview-only entries · {payload?.conflict==='skip'?'Skip duplicates':'Keep both'} · Existing words and SRS remain unchanged.</p></div>
      {confirmationCard&&<><p className="text-sm">Source row {confirmationCard.row} · {confirmationCard.status}{confirmationCard.duplicate?' · duplicate':''} {confirmationCard.message}</p><VocabularyCard row={confirmationCard} readOnly/><div className="flex flex-wrap justify-between gap-3 text-sm"><button className="underline" disabled={confirmExample===0||busy} onClick={()=>setConfirmExample(i=>i-1)}>Previous confirmed example</button><span>{confirmExample+1} / {confirmationRows.length}</span><button className="underline" disabled={confirmExample+1>=confirmationRows.length||busy} onClick={()=>setConfirmExample(i=>i+1)}>Next confirmed example</button></div><div className="flex flex-wrap gap-2">{representative(confirmationRows,7).map((row,i)=><button key={row.row} className="rounded-lg bg-slate-100 px-3 py-2 text-xs" onClick={()=>setConfirmExample(confirmationRows.indexOf(row))}>Confirmed sample {i+1}</button>)}</div></>}
      <div className="flex flex-wrap justify-between gap-3"><button className="text-sm underline" disabled={busy} onClick={()=>{invalidate();setStage('preview');}}>Back to preview &amp; adjustments</button><button className={buttonStyle} disabled={busy||!preview.ready} onClick={save}>{busy&&<Loader2 size={16} className="animate-spin"/>} Confirm import</button></div>{busy&&<progress className="w-full" value={progress} max={payload?.rows.length}/>}</section>}
    {stage==='result'&&result&&<section className="space-y-5 rounded-2xl border bg-white p-6"><h2 className="flex items-center gap-2 text-xl font-bold"><CheckCircle2 size={20}/>{result.failed?'Import needs attention':'Import result'}</h2><p className="text-sm">{result.imported} imported · {result.resumed} recovered / already saved · {result.skipped} skipped · {result.invalid} invalid · {result.failed} failed</p><div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Row</th><th className="p-2">Word</th><th className="p-2">Status</th><th className="p-2">Details</th></tr></thead><tbody>{representative(result.rows).map(row=><tr key={row.row} className="border-t"><td className="p-2">{row.row}</td><td className="p-2">{row.word||'—'}</td><td className="p-2">{row.status}</td><td className="p-2">{row.message}</td></tr>)}</tbody></table></div><div className="flex flex-wrap gap-4">{!!result.failed&&<button className={buttonStyle} disabled={busy} onClick={save}>Retry safely</button>}<Link to="/library?type=vocabulary" className={buttonStyle}>Open Vocabulary</Link><Link to="/learn?method=vocabulary" className="underline">Practice vocabulary</Link><button className="underline" onClick={()=>{setStage('upload');setError('');}}>Import another list</button><button className="underline" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='voca-import-report.json';a.click();URL.revokeObjectURL(url);}}>Download full report</button></div></section>}
  </div>;
}
