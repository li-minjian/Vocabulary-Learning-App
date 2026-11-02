import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BookOpen, Loader2, Pause, Play, Plus, RotateCcw, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ArticleTypingSurface } from '../components/ArticleTypingSurface';
import { DictionaryPanel } from '../components/DictionaryPanel';
import { fetchArticle, fetchArticles, saveArticle, type Article } from '../../lib/articles';
import { findDictionaryPhrases, type DictionaryPhraseSpan } from '../../lib/dictionary';
import { cancelUpload, processUpload, validateFile, type DocumentExtraction, type UploadProgress } from '../../lib/uploads';
import { applyTypingInput, articleSpans, emptyTypingState, normalizeArticle, restoreTypingState, serializeTypingState, typingMetrics, type TypingState } from '../../lib/typingEngine';

const controlClass = 'rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed';

function PracticeSession({ article }: { article: Article }) {
  const { user } = useAuth();
  const source = useMemo(() => normalizeArticle(article.raw_text), [article.raw_text]);
  const storageKey = `voca:typing:v1:${user?.id || 'anonymous'}:${article.id}`;
  const [storageError, setStorageError] = useState('');
  const [state, setState] = useState<TypingState>(emptyTypingState);
  const [restored, setRestored] = useState(false);
  const [paused, setPaused] = useState(true);
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | null>(null);
  const [phrases, setPhrases] = useState<DictionaryPhraseSpan[]>([]);
  const [phraseError, setPhraseError] = useState('');
  const latestState = useRef(state);
  const lastInput = useRef(0);
  const lastTick = useRef(0);
  const metrics = useMemo(() => typingMetrics(source, state), [source, state]);
  const spans = useMemo(() => articleSpans(source), [source]);
  const currentWord = spans.find(span => span.kind === 'word' && span.end > metrics.position)?.text;
  latestState.current = state;

  useEffect(() => {
    try {
      const saved = restoreTypingState(source, localStorage.getItem(storageKey));
      setState(saved || emptyTypingState());
    } catch {
      setStorageError('Browser storage is unavailable. This session cannot be resumed after closing the page.');
    }
    setRestored(true);
  }, [source, storageKey]);

  useEffect(() => {
    const controller = new AbortController();
    setPhrases([]); setPhraseError('');
    // The phrase endpoint accepts 20k characters; use bounded chunks with overlap
    // so long articles keep exact global positions and phrases across chunk edges.
    const characters = Array.from(source);
    const load = async () => {
      const found = new Map<string, DictionaryPhraseSpan>();
      for (let start = 0; start < characters.length; start += 19000) {
        const items = await findDictionaryPhrases(characters.slice(start, start + 20000).join(''), article.language, controller.signal);
        for (const item of items) {
          const phrase = { ...item, start: item.start + start, end: item.end + start };
          found.set(`${phrase.start}:${phrase.end}`, phrase);
        }
      }
      if (!controller.signal.aborted) setPhrases([...found.values()].sort((a, b) => a.start - b.start));
    };
    load().catch(() => { if (!controller.signal.aborted) setPhraseError('Local phrase matching is unavailable. Individual word lookup remains available.'); });
    return () => controller.abort();
  }, [source, article.language]);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(storageKey, serializeTypingState(source, latestState.current));
      setStorageError('');
    } catch {
      setStorageError('Progress could not be saved in this browser. Keep this page open to continue the session.');
    }
  }, [source, storageKey]);

  useEffect(() => {
    if (!restored) return;
    const save = () => persist();
    window.addEventListener('pagehide', save);
    return () => { window.removeEventListener('pagehide', save); persist(); };
  }, [restored, persist]);

  useEffect(() => {
    if (!restored) return;
    const save = () => persist();
    const timeout = window.setTimeout(save, 350);
    return () => window.clearTimeout(timeout);
  }, [state, restored, persist]);

  useEffect(() => {
    if (paused || metrics.complete) return;
    lastTick.current = Date.now();
    const tick = window.setInterval(() => {
      const now = Date.now();
      const activeUntil = lastInput.current + 10000;
      const elapsed = Math.max(0, Math.min(now, activeUntil) - lastTick.current);
      lastTick.current = now;
      if (elapsed) setState(previous => ({ ...previous, elapsedMs: previous.elapsedMs + elapsed }));
    }, 250);
    const hide = () => { if (document.hidden) setPaused(true); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.clearInterval(tick); document.removeEventListener('visibilitychange', hide); };
  }, [paused, metrics.complete]);

  const onInput = useCallback((text: string) => {
    if (paused) return;
    const now = Date.now();
    // Resume the clock on a new burst without counting time spent idle.
    if (now - lastInput.current > 10000) lastTick.current = now;
    lastInput.current = now;
    setState(previous => applyTypingInput(source, previous, text));
  }, [paused, source]);

  const onLookup = useCallback((text: string, start: number, end: number) => setSelection({ text, start, end }), []);
  const context = selection ? Array.from(source).slice(Math.max(0, selection.start - 120), selection.end + 120).join('') : '';
  const restart = () => {
    setPaused(true);
    lastInput.current = 0;
    setState(emptyTypingState());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/practice" className="text-xs font-semibold text-teal-800 underline underline-offset-4">Article library</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{article.title || 'Untitled article'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{article.language} · {metrics.totalWords} words · Reading & typing</p>
        </div>
        <div className="flex gap-2">
          <button className={controlClass} onMouseDown={event => event.preventDefault()} onClick={() => setPaused(value => !value)} disabled={!restored}>
            {paused ? <Play className="mr-2 inline size-4" /> : <Pause className="mr-2 inline size-4" />}
            {paused ? state.typed ? 'Resume practice' : 'Start typing' : 'Pause'}
          </button>
          <button className={controlClass} onClick={restart}><RotateCcw className="mr-2 inline size-4" />Restart</button>
        </div>
      </div>
      {storageError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{storageError}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['WPM', metrics.wpm],
          ['Copy accuracy', `${Math.round(metrics.accuracy)}%`],
          ['Progress', `${Math.round(metrics.progress)}%`],
          ['Active time', `${Math.floor(state.elapsedMs / 60000)}:${String(Math.floor(state.elapsedMs / 1000) % 60).padStart(2, '0')}`],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-white px-4 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-primary">{value}</p></div>)}
      </div>
      <div role="progressbar" aria-label="Article progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(metrics.progress)} className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-teal-600 transition-[width]" style={{ width: `${metrics.progress}%` }} /></div>
      {metrics.complete && <div role="status" className="rounded-2xl border border-teal-200 bg-teal-50 p-5"><h2 className="font-bold text-teal-900">Article completed</h2><p className="mt-1 text-sm text-teal-900">{metrics.correctWords} of {metrics.completedWords} completed words copied correctly. Copy accuracy includes corrected mistakes. This practice does not change recall scores or SRS mastery.</p><Link className="mt-3 inline-block text-sm font-semibold text-teal-900 underline" to="/review">Review saved vocabulary</Link></div>}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.85fr)_minmax(290px,1fr)]">
        <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <ArticleTypingSurface source={source} typed={state.typed} paused={paused} onInput={onInput} onPause={() => setPaused(true)} onLookup={onLookup} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span>{metrics.correctWords}/{metrics.completedWords} completed words correct</span><span>{storageError ? 'Progress remains in this page' : 'Progress saved in this browser'} · Idle timer stops after 10 seconds</span></div>
        </div>
        <aside className="min-w-0 space-y-3 xl:sticky xl:top-20">
          <div className="rounded-xl border border-border bg-white px-4 py-3"><p className="text-xs text-muted-foreground">Current word</p><p className="mt-1 break-words font-mono font-semibold text-primary">{currentWord || 'Article completed'}</p></div>
          {phrases.length > 0 && <div className="rounded-xl border border-border bg-white p-4"><h2 className="text-sm font-semibold text-primary">Expressions in this article</h2><div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{phrases.map(phrase => <button key={`${phrase.start}:${phrase.end}`} type="button" onMouseDown={event => event.preventDefault()} onClick={() => onLookup(phrase.text, phrase.start, phrase.end)} className="rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-xs text-teal-900 hover:bg-teal-100">{phrase.text}</button>)}</div></div>}
          {phraseError && <p role="status" className="text-xs text-amber-800">{phraseError}</p>}
          {selection ? <>
            <p className="text-xs text-muted-foreground">Selected text · positions {selection.start}–{selection.end}</p>
            <DictionaryPanel query={selection.text} language={article.language} context={context} />
          </> : <div className="rounded-2xl border border-border bg-white p-6"><BookOpen className="size-6 text-teal-700" /><h2 className="mt-4 text-lg font-bold text-primary">Words in context</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Click any article word for its local dictionary entry. Shift+click another word to inspect a phrase or collocation.</p><p className="mt-4 text-xs leading-relaxed text-muted-foreground">Your typing position stays in place. AI is requested only when you choose Ask AI.</p></div>}
          <p className="text-xs leading-relaxed text-muted-foreground">Copy practice measures transcription. Save useful words to Vocabulary, then use Review for active recall.</p>
        </aside>
      </div>
    </div>
  );
}

export function TypingPractice() {
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const [articles, setArticles] = useState<Article[]>([]);
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('English');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<DocumentExtraction | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [sourceType, setSourceType] = useState<'paste' | 'text_file'>('paste');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const suggestedTitle = useRef('');
  useEffect(() => () => uploadController.current?.abort(), []);

  const extractFile = async (file: File, method: 'local' | 'ai' = 'local') => {
    setUploadError('');
    try {
      if (!/\.(pdf|txt|md|markdown)$/i.test(file.name)) throw new Error('Choose a PDF, TXT or Markdown file.');
      validateFile(file, 'article');
    } catch (reason) {
      setUploadFile(null); setUploadResult(null);
      setUploadError(reason instanceof Error ? reason.message : 'Invalid article file.');
      return;
    }
    setUploadFile(file);
    if (file !== uploadFile) {
      setUploadResult(null);
      const previousSuggestion = suggestedTitle.current;
      const nextTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 250);
      setTitle(previous => !previous.trim() || previous === previousSuggestion ? nextTitle : previous);
      suggestedTitle.current = nextTitle;
    }
    setExtracting(true);
    uploadController.current = new AbortController();
    try {
      const result = await processUpload<DocumentExtraction>(file, 'article', {
        method, signal: uploadController.current.signal, onProgress: setUploadProgress,
      });
      setUploadResult(result);
      if (result.text) { setText(result.text); setSourceType('text_file'); }
    } catch (reason) {
      setUploadError(reason instanceof DOMException && reason.name === 'AbortError' ? 'Upload cancelled. Your editor text is unchanged.' : reason instanceof Error ? reason.message : 'Could not extract this article.');
    } finally { setExtracting(false); setUploadProgress(null); }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setArticle(null);
    const load = articleId ? fetchArticle(articleId).then(value => { if (!cancelled) setArticle(value); }) : fetchArticles().then(value => { if (!cancelled) setArticles(value); });
    load.catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load articles.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [articleId, reload]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || saving || extracting) return;
    setSaving(true); setError('');
    try {
      const value = await saveArticle({ title: title.trim() || 'Untitled article', raw_text: text.trim(), language, source_type: sourceType });
      navigate(`/practice/${value.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save article. Your text is still available below.');
    } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-8">
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}<button type="button" onClick={() => setReload(value => value + 1)} className="ml-3 underline">Retry loading</button>{articleId && <Link to="/practice" className="ml-3 underline">Article library</Link>}</div>}
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading articles…</p> : article ? <PracticeSession key={`${article.id}:${article.raw_text.length}`} article={article} /> : !articleId && <>
        <div className="border-b border-border pb-5"><h1 className="text-[28px] font-bold tracking-tight text-primary">Reading & Typing</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Practice with your own articles, explore words in context, and save what you want to remember. Typing and local dictionary lookup do not request AI.</p></div>
        <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
          <form onSubmit={create} className="space-y-4 rounded-2xl border border-border bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-primary"><Plus className="mr-2 inline size-5" />Add an article</h2>
              <button type="button" className={controlClass} disabled={extracting || saving} onClick={() => fileInput.current?.click()}><Upload className="mr-2 inline size-4" />Upload file</button>
              <input ref={fileInput} type="file" aria-label="Article file" accept=".pdf,.txt,.md,.markdown" className="hidden" disabled={extracting || saving} onChange={event => { const file = event.target.files?.[0]; if (file) void extractFile(file); event.target.value = ''; }} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">Upload PDF, TXT or Markdown, or paste below. Up to 50 MiB; article text up to 100,000 characters. TXT/Markdown must be UTF-8; PDFs support up to 200 pages. Successful extraction replaces the editor text for review before saving.</p>
            {uploadProgress && <div role="status" className="space-y-2 text-sm"><p>{uploadProgress.stage === 'processing' ? 'Extracting article text…' : `${uploadProgress.stage === 'authorizing' ? 'Authorizing upload' : 'Uploading file'}… ${uploadProgress.percent}%`}</p><progress aria-label="Article file upload progress" max={100} value={uploadProgress.percent} className="w-full" /><button type="button" className="underline" onClick={() => { uploadController.current?.abort(); if (uploadFile) void cancelUpload(uploadFile).catch(() => {}); }}>Cancel upload</button></div>}
            {uploadError && <div role="alert" className="text-sm text-rose-800">{uploadError}{uploadFile && <button type="button" className="ml-3 underline" disabled={extracting} onClick={() => extractFile(uploadFile)}>Retry extraction</button>}</div>}
            {uploadResult?.warnings?.map((warning, index) => <p key={index} className="text-xs text-muted-foreground">{warning}</p>)}
            {uploadResult?.text && <p role="status" className="text-sm text-teal-800">Text extracted. Preview and edit below, then save to start practice.</p>}
            {uploadResult?.needs_ocr && <div className="space-y-2 text-sm"><p>No usable PDF text layer was found. OCR/AI requires your explicit consent.</p>{uploadResult.ai_allowed && uploadFile ? <><button type="button" className={controlClass} disabled={extracting} onClick={() => extractFile(uploadFile, 'ai')}>Ask AI to extract this PDF</button><p className="text-xs text-muted-foreground">Only this action sends the PDF to the AI provider. AI supports up to 20 MiB and 100 pages.</p></> : <p>OCR locally or split the PDF first. AI supports up to 20 MiB and 100 pages.</p>}</div>}
            <label className="block text-sm font-semibold text-slate-700">Title<input value={title} maxLength={250} onChange={event => setTitle(event.target.value)} placeholder="What are you reading?" className="mt-2 w-full rounded-xl border border-border px-3 py-2.5 text-sm font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">Language<select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value)} className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm font-normal"><option>English</option><option>German</option></select></label>
            <label className="block text-sm font-semibold text-slate-700">Article text<textarea aria-label="Article text" required value={text} maxLength={100000} disabled={extracting} onChange={event => setText(event.target.value)} rows={12} placeholder="Paste an article or a passage here…" className="mt-2 w-full resize-y rounded-xl border border-border p-3 text-sm font-normal leading-relaxed" /></label>
            <p className="text-xs text-muted-foreground">{text.trim().split(/\s+/u).filter(Boolean).length} words · {text.length.toLocaleString()}/100,000 characters · Saved to your library only after confirmation</p>
            <button type="submit" disabled={saving || extracting || !text.trim()} className={`${controlClass} w-full !border-primary !bg-primary !text-white`}>{saving ? 'Saving article…' : 'Save & start practice'}</button>
          </form>
          <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-primary">Your article library</h2><span className="text-xs text-muted-foreground">{articles.length} articles</span></div>
            {!articles.length ? <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center"><BookOpen className="mx-auto size-7 text-slate-400" /><p className="mt-4 text-sm font-semibold text-primary">Your next reading session starts here</p><p className="mt-2 text-sm text-muted-foreground">Upload or paste an article to save it and begin typing. Articles saved from Article Import will also appear here.</p></div> : <div className="space-y-3">{articles.map(item => <Link key={item.id} to={`/practice/${item.id}`} className="block rounded-2xl border border-border bg-white p-5 transition-colors hover:border-teal-400"><h3 className="break-words font-semibold text-primary">{item.title || 'Untitled article'}</h3><p className="mt-2 text-xs text-muted-foreground">{item.language} · {item.raw_text.trim().split(/\s+/u).filter(Boolean).length} words</p><p className="mt-3 line-clamp-2 break-words text-sm leading-relaxed text-slate-500">{item.raw_text}</p><span className="mt-4 block text-xs font-semibold text-teal-800">Open practice →</span></Link>)}</div>}
          </section>
        </div>
      </>}
    </div>
  );
}
