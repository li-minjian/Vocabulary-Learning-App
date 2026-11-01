import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { fetchArticles, type Article } from '../../lib/articles';
import { normalizeArticle, restoreTypingState, typingMetrics } from '../../lib/typingEngine';

/** Reads the existing article + local-progress owners; never writes SRS or shadow totals. */
export function TypingProgressSummary() {
  const { user } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [, setRevision] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetchArticles().then(value => { if (!cancelled) setArticles(value); }).catch(() => {
      if (!cancelled) setError('Typing progress cannot be loaded while the article library is unavailable.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, refresh]);

  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    window.addEventListener('storage', update);
    window.addEventListener('focus', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('focus', update); };
  }, []);

  let sessions = 0, completed = 0, totalAttempts = 0, correctAttempts = 0, correctCharacters = 0, elapsedMs = 0;
  let unavailable = false;
  for (const article of articles) {
    try {
      const source = normalizeArticle(article.raw_text);
      const state = restoreTypingState(source, localStorage.getItem(`voca:typing:v1:${user?.id || 'anonymous'}:${article.id}`));
      if (!state || !state.totalAttempts) continue;
      const metrics = typingMetrics(source, state);
      sessions++;
      completed += Number(metrics.complete);
      totalAttempts += state.totalAttempts;
      correctAttempts += state.correctAttempts;
      correctCharacters += metrics.correctCharacters;
      elapsedMs += state.elapsedMs;
    } catch { unavailable = true; }
  }
  const accuracy = totalAttempts ? `${Math.round(correctAttempts / totalAttempts * 100)}%` : '—';
  const wpm = elapsedMs >= 1000 ? Math.round(correctCharacters / 5 / (elapsedMs / 60000)) : '—';

  return (
    <section aria-label="Typing practice statistics" className="rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-primary">Reading & typing progress</h2><p className="mt-1 text-xs text-muted-foreground">Saved in this browser · Latest attempt per article · Separate from recall and SRS</p></div><Link to="/practice" className="text-sm font-semibold text-teal-800 underline underline-offset-4">Continue practice</Link></div>
      {loading ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading typing progress…</p> : error || unavailable ? <p role="status" className="mt-4 text-sm text-amber-900">{error || 'Browser storage is unavailable.'}<button onClick={() => setRefresh(value => value + 1)} className="ml-3 underline">Retry</button></p> : <>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Articles practiced', sessions], ['Articles completed', completed], ['Copy accuracy', accuracy], ['Copy WPM', wpm]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-bold text-primary">{value}</p></div>)}</div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{Math.floor(elapsedMs / 60000)} active minutes. Copy accuracy includes corrected mistakes. Typing does not indicate vocabulary mastery; use Review to measure recall.</p>
      </>}
    </section>
  );
}
