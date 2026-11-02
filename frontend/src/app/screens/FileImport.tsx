import { useEffect, useRef, useState } from 'react';
import { validateFile, cancelUpload, type UploadProgress } from '../../lib/uploads';
import { Link } from 'react-router';
import { ArrowLeft, CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { createCollection, fetchCollections, type Collection } from '../../lib/api';
import { commitList, parseList, previewList, type ImportPayload, type ImportPreview, type ImportResult, type ImportRow, type ParsedList, type RowResult } from '../../lib/fileImport';

const fields = [
  ['word', 'Word / phrase (required)', ['word', 'term', 'front', 'expression', 'vocabulary', '单词', '词语']],
  ['language', 'Row language (optional)', ['language', 'lang', '语言']],
  ['collocations', 'Collocations (lines or semicolons)', ['collocations', 'collocation', 'phrases', '搭配']],
  ['translation', 'Translation', ['translation', 'back', 'meaning', '翻译']],
  ['definition', 'Definition / notes', ['definition', 'notes', 'explanation']],
  ['examples', 'Example', ['example', 'examples', 'sentence', 'context']],
  ['tags', 'Tags', ['tags', 'anki tags']],
  ['source', 'Source / deck', ['source', 'source deck', 'deck']],
  ['pos', 'Part of speech', ['pos', 'part of speech']],
  ['ipa', 'Pronunciation / IPA', ['ipa', 'pronunciation']],
] as const;
const inputStyle = 'w-full min-h-10 rounded-xl border border-border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600';
const buttonStyle = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#002434] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600';

export function FileImport() {
  const [stage, setStage] = useState<'upload' | 'map' | 'confirm' | 'result'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [delimiter, setDelimiter] = useState('');
  const [header, setHeader] = useState('auto');
  const [parsed, setParsed] = useState<ParsedList | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [sourcePage, setSourcePage] = useState(0);
  const [language, setLanguage] = useState('English');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [conflict, setConflict] = useState<'skip' | 'keep_both'>('skip');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const [collectionError, setCollectionError] = useState('');
  let fileValidation = '';
  try { if (file) validateFile(file, 'file'); } catch (cause) { fileValidation = cause instanceof Error ? cause.message : 'Invalid file.'; }

  useEffect(() => { void loadCollections(); }, []);
  useEffect(() => () => uploadController.current?.abort(), []);
  async function loadCollections() {
    try { setCollections(await fetchCollections()); setCollectionError(''); }
    catch { setCollectionError('Collections could not be loaded. Retry before choosing a collection.'); }
  }
  async function parse() {
    setBusy(true); setError('');
    uploadController.current = new AbortController();
    try {
      if (file) validateFile(file, 'file');
      const list = await parseList(file, text, delimiter, header, { signal: uploadController.current.signal, onProgress: setUploadProgress });
      const next: Record<string, string> = {};
      fields.forEach(([key, , aliases]) => {
        const index = list.columns.findIndex(column => (aliases as readonly string[]).includes(column.trim().toLowerCase()));
        next[key] = index < 0 ? '' : String(index);
      });
      if (!next.word) next.word = '0';
      if (!next.translation && list.columns.length > 1 && next.word !== '1') next.translation = '1';
      // A new upload is a new import; retries retain this exact identity.
      list.import_id = `${list.import_id.slice(0, 64)}:${crypto.randomUUID()}`;
      setParsed(list); setMapping(next); setSelectedRows(new Set(list.row_numbers)); setSourcePage(0); setStage('map');
    } catch (cause) { setError(cause instanceof DOMException && cause.name === 'AbortError' ? 'Upload cancelled. You can retry.' : cause instanceof Error ? cause.message : 'Unable to parse this list.'); }
    finally { setBusy(false); setUploadProgress(null); }
  }
  async function checkPreview() {
    if (!parsed || mapping.word === '') return;
    setBusy(true); setError('');
    try {
      const rows: ImportRow[] = parsed.rows.map((cells, index) => {
        const row = { row: parsed.row_numbers[index], word: '' } as ImportRow;
        fields.forEach(([key]) => {
          const column = mapping[key];
          if (column !== '' && column !== undefined) (row as unknown as Record<string, string | number>)[key] = cells[Number(column)] || '';
        });
        return row;
      });
      const request: ImportPayload = { import_id: parsed.import_id, rows: rows.filter(row => selectedRows.has(row.row)), language, collection_id: collectionId || null, conflict };
      setPreview(await previewList(request)); setPayload(request); setStage('confirm');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to check duplicates.'); }
    finally { setBusy(false); }
  }
  async function addCollection() {
    setBusy(true); setError('');
    try {
      const created = await createCollection({ name: newCollection.trim() });
      setCollections(previous => [...previous, created]); setCollectionId(created.id); setNewCollection('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create collection.'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!payload) return;
    setBusy(true); setError(''); setProgress(0);
    const combined: ImportResult = { import_id: payload.import_id, imported: 0, resumed: 0, skipped: 0, invalid: 0, failed: 0, rows: [] };
    try {
      for (let start = 0; start < payload.rows.length; start += 100) {
        try {
          const part = await commitList({ ...payload, rows: payload.rows.slice(start, start + 100) });
          combined.rows.push(...part.rows);
        } catch (cause) {
          combined.rows.push(...payload.rows.slice(start).map(row => ({ row: row.row, word: row.word, status: 'failed' as const,
            message: 'Persistence was not confirmed. Retry with this same import to reconcile saved rows.' })));
          setError(cause instanceof Error ? cause.message : 'Connection interrupted.');
          break;
        }
        setProgress(Math.min(start + 100, payload.rows.length));
      }
      combined.imported = combined.rows.filter(row => row.status === 'imported').length;
      combined.resumed = combined.rows.filter(row => row.status === 'resumed').length;
      combined.skipped = combined.rows.filter(row => row.status === 'skipped').length;
      combined.invalid = combined.rows.filter(row => row.status === 'invalid').length;
      combined.failed = combined.rows.filter(row => row.status === 'failed').length;
      setResult(combined); setStage('result');
    } finally { setBusy(false); }
  }
  const resultRows: RowResult[] = stage === 'result' ? result?.rows || [] : preview?.rows || [];

  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <Link to="/import" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} /> Back to Import</Link>
    <header className="border-b border-border pb-5"><h1 className="text-3xl font-bold tracking-tight text-[#002434]">File &amp; List Import</h1>
      <p className="mt-2 text-sm text-muted-foreground">Upload → map fields → preview duplicates → confirm. No AI requests are made.</p></header>
    <ol aria-label="Import steps" className="flex flex-wrap gap-4 text-sm">{(['upload', 'map', 'confirm', 'result'] as const).map((step, i) => <li key={step} aria-current={stage === step ? 'step' : undefined} className={stage === step ? 'font-bold text-teal-700' : 'text-muted-foreground'}>{i + 1}. {({ upload: 'Upload', map: 'Map & destination', confirm: 'Preview & confirm', result: 'Result' })[step]}</li>)}</ol>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {stage === 'upload' && <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
      <div><label htmlFor="voca-file" className="mb-2 block text-sm font-semibold">Vocabulary file (up to 50 MiB)</label>
        <input id="voca-file" type="file" accept=".csv,.tsv,.txt,.apkg" className={inputStyle} disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); }} />
        <p className="mt-2 text-xs text-muted-foreground">CSV, TSV, Anki plain-text export or APKG. Scheduling and media are excluded.</p></div>
      {!file && <div><label htmlFor="voca-pasted-list" className="mb-2 block text-sm font-semibold">Or paste a vocabulary list</label><textarea id="voca-pasted-list" className={`${inputStyle} font-mono`} rows={6} placeholder={'word\ttranslation\ncurious\t好奇的'} value={text} onChange={event => setText(event.target.value)} disabled={busy} /></div>}
      <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="voca-delimiter" className="mb-2 block text-sm font-semibold">Delimiter</label><select id="voca-delimiter" value={delimiter} onChange={event => setDelimiter(event.target.value)} className={inputStyle}><option value="">Detect automatically</option><option value={','}>Comma</option><option value={'\t'}>Tab</option><option value=";">Semicolon</option><option value="|">Pipe</option></select></div>
        <div><label htmlFor="voca-header" className="mb-2 block text-sm font-semibold">First row</label><select id="voca-header" className={inputStyle} value={header} onChange={event => setHeader(event.target.value)}><option value="auto">Detect headers</option><option value="true">Column headers</option><option value="false">Vocabulary data (no header)</option></select></div></div>
      <button className={buttonStyle} disabled={busy || (!file && !text.trim()) || !!fileValidation} onClick={parse}>{busy ? <Loader2 className="animate-spin" size={16} /> : <FileUp size={16} />} Parse list</button>
      {fileValidation && <p role="alert" className="text-sm text-red-700">{fileValidation}</p>}
      {uploadProgress && <div role="status"><p className="text-sm">{uploadProgress.stage === 'processing' ? 'Verifying and parsing…' : `${uploadProgress.stage} ${uploadProgress.percent}%`}</p><progress className="w-full" max={100} value={uploadProgress.percent} /><button type="button" className="mt-2 text-sm underline" onClick={() => { uploadController.current?.abort(); if (file) void cancelUpload(file).catch(() => {}); }}>Cancel upload</button></div>}
    </section>}
    {parsed && stage === 'map' && <>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-6"><h2 className="text-lg font-bold">Map your {parsed.count.toLocaleString()} rows</h2>
        <div className="flex flex-wrap items-center gap-4 text-sm"><span>{selectedRows.size.toLocaleString()} rows selected</span><button className="underline" onClick={() => setSelectedRows(new Set(parsed.row_numbers))}>Select all rows</button><button className="underline" onClick={() => setSelectedRows(new Set())}>Deselect all rows</button></div>
        <p className="text-sm text-muted-foreground">Only Word is required. Row language overrides the destination default; blank language cells use the default. Leave unavailable fields unmapped. Blank words are reported and skipped. Custom Anki note fields need manual mapping.</p>
        {parsed.warnings.map((warning, i) => <p key={i} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
        {!!parsed.invalid_rows.length && <p className="text-sm text-amber-900">{parsed.invalid_rows.length} rows have different column counts. Available cells remain mappable; missing values stay blank.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label]) => <div key={key}><label className="mb-2 block text-sm font-semibold" htmlFor={`voca-map-${key}`}>{label}</label><select id={`voca-map-${key}`} className={inputStyle} value={mapping[key]} onChange={event => setMapping(current => ({ ...current, [key]: event.target.value }))}><option value="">Do not import</option>{parsed.columns.map((column, index) => <option key={index} value={String(index)}>{index + 1}. {column || '(unnamed column)'}</option>)}</select></div>)}</div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="py-3 text-left text-xs text-muted-foreground">Source rows {sourcePage * 50 + 1}–{Math.min((sourcePage + 1) * 50, parsed.count)}. Choose the rows to include.</caption><thead><tr><th className="p-2">Include</th><th className="p-2">Row</th>{parsed.columns.map((column, i) => <th className="min-w-32 p-2" key={i}>{column}</th>)}</tr></thead><tbody>{parsed.rows.slice(sourcePage * 50, (sourcePage + 1) * 50).map((row, i) => {
          const number = parsed.row_numbers[sourcePage * 50 + i];
          return <tr key={number} className="border-t border-border"><td className="p-2"><input type="checkbox" aria-label={`Include source row ${number}`} checked={selectedRows.has(number)} onChange={event => setSelectedRows(previous => { const next = new Set(previous); if (event.target.checked) next.add(number); else next.delete(number); return next; })} /></td><td className="p-2">{number}</td>{parsed.columns.map((_, j) => <td key={j} className="max-w-80 whitespace-pre-wrap break-words p-2">{(row[j] || '').slice(0, 200)}</td>)}</tr>;
        })}</tbody></table></div>
        {parsed.count > 50 && <div className="flex justify-between text-sm"><button className="underline disabled:opacity-50" disabled={sourcePage === 0} onClick={() => setSourcePage(page => page - 1)}>Previous rows</button><span>Page {sourcePage + 1} of {Math.ceil(parsed.count / 50)}</span><button className="underline disabled:opacity-50" disabled={(sourcePage + 1) * 50 >= parsed.count} onClick={() => setSourcePage(page => page + 1)}>Next rows</button></div>}
      </section>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-6"><h2 className="text-lg font-bold">Destination &amp; duplicates</h2><div className="grid gap-4 sm:grid-cols-3">
        <div><label htmlFor="voca-language" className="mb-2 block text-sm font-semibold">Default language</label><select id="voca-language" className={inputStyle} value={language} onChange={event => setLanguage(event.target.value)}>{['English', 'German', 'French', 'Spanish', 'Japanese', 'Chinese'].map(value => <option key={value}>{value}</option>)}</select></div>
        <div><label htmlFor="voca-collection" className="mb-2 block text-sm font-semibold">Collection</label><select id="voca-collection" className={inputStyle} value={collectionId} onChange={event => setCollectionId(event.target.value)}><option value="">Library root</option>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></div>
        <div><label htmlFor="voca-conflict" className="mb-2 block text-sm font-semibold">Existing words</label><select id="voca-conflict" className={inputStyle} value={conflict} onChange={event => setConflict(event.target.value as 'skip' | 'keep_both')}><option value="skip">Skip duplicates (recommended)</option><option value="keep_both">Keep both as separate words</option></select></div></div>
        {collectionError && <p role="alert" className="text-sm text-red-700">{collectionError} <button className="underline" onClick={loadCollections}>Retry collections</button></p>}
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><label htmlFor="voca-new-collection" className="mb-2 block text-sm font-semibold">Create a collection (optional)</label><input id="voca-new-collection" className={inputStyle} value={newCollection} onChange={event => setNewCollection(event.target.value)} maxLength={255} /></div><button className={buttonStyle} disabled={busy || !newCollection.trim()} onClick={addCollection}>Create collection</button></div>
        <p className="text-xs text-muted-foreground">Duplicates use word + language, ignoring case and repeated spaces. Existing translations, notes and SRS history are never overwritten.</p>
      </section>
      <div className="flex justify-between gap-3"><button className="text-sm underline" disabled={busy} onClick={() => setStage('upload')}>Change source</button><button className={buttonStyle} disabled={busy || mapping.word === '' || !selectedRows.size} onClick={checkPreview}>{busy && <Loader2 className="animate-spin" size={16} />} Check duplicates &amp; preview</button></div>
    </>}
    {(stage === 'confirm' || stage === 'result') && <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">{stage === 'result' && <CheckCircle2 size={20} />} {stage === 'confirm' ? 'Review before importing' : result?.failed ? 'Import needs attention' : 'Import result'}</h2>
      <p className="text-sm">{stage === 'confirm' ? `${preview?.ready} ready · ${preview?.skipped} duplicates skipped · ${preview?.invalid} invalid rows` : `${result?.imported} imported · ${result?.resumed} recovered / already saved · ${result?.skipped} skipped · ${result?.invalid} invalid · ${result?.failed} failed`}</p>
      {stage === 'confirm' && <p className="text-sm text-muted-foreground">Default language: {payload?.language} · Destination: {collections.find(collection => collection.id === payload?.collection_id)?.name || 'Library root'} · Duplicate policy: {payload?.conflict === 'skip' ? 'Skip' : 'Keep both'}. Existing vocabulary and review data will be preserved.</p>}
      {busy && <div role="status" aria-live="polite"><p className="mb-2 text-sm">Importing {progress} / {payload?.rows.length} rows…</p><progress className="h-2 w-full" value={progress} max={payload?.rows.length} /></div>}
      <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><caption className="py-2 text-left text-xs text-muted-foreground">{resultRows.length > 100 ? `Showing first 100 of ${resultRows.length} rows. Download the full result below.` : 'Per-row import status'}</caption><thead><tr><th className="p-2">Row</th><th className="p-2">Word</th><th className="p-2">Status</th><th className="p-2">Details</th></tr></thead><tbody>{resultRows.slice(0, 100).map((row, i) => <tr key={i} className="border-t border-border"><td className="p-2">{row.row}</td><td className="p-2">{row.word || '—'}</td><td className="p-2">{row.status}{row.duplicate ? ' (duplicate)' : ''}</td><td className="p-2 text-muted-foreground">{row.message || ''}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap gap-4">{stage === 'confirm' ? <><button className="text-sm underline" disabled={busy} onClick={() => setStage('map')}>Back to mapping</button><button className={buttonStyle} disabled={busy || !preview?.ready} onClick={save}>{busy && <Loader2 className="animate-spin" size={16} />} Confirm import</button></> : <>
        {!!result?.failed && <button className={buttonStyle} disabled={busy} onClick={save}>Retry safely</button>}
        <Link to="/vocabulary" className={buttonStyle}>Open Vocabulary</Link>
        <Link to="/review" className="self-center text-sm underline">Review imported words</Link>
        <button className="text-sm underline" disabled={busy} onClick={() => { setStage('upload'); setResult(null); setError(''); }}>Import another list</button>
      </>}
      <button className="text-sm underline" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(stage === 'result' ? result : preview, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'voca-import-report.json'; anchor.click(); URL.revokeObjectURL(url);
      }}>Download full report</button></div>
    </section>}
  </div>;
}
