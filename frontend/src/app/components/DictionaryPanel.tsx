import { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Plus, Sparkles, Volume2 } from 'lucide-react';
import { createWord, enrichWord, fetchWords } from '../../lib/api';
import { lookupDictionary, type DictionaryEntry } from '../../lib/dictionary';
import type { VocabularyWord } from '../../lib/types';
import { speakWord } from '../../lib/speech';

interface DictionaryPanelProps {
  query: string;
  language: string;
  context?: string;
  collectionId?: string;
  onSaved?: () => void;
}

export function DictionaryPanel({ query, language, context, collectionId, onSaved }: DictionaryPanelProps) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [aiEntry, setAiEntry] = useState<Partial<VocabularyWord> | null>(null);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedPhrase, setSelectedPhrase] = useState('');
  const generation = useRef(0);
  const selection = selectedPhrase || query;

  useEffect(() => { setSelectedPhrase(''); }, [query, language]);

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    setEntry(null); setAiEntry(null); setError(''); setNotice(''); setAsking(false); setSaving(false);
    if (!selection.trim()) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    lookupDictionary(selection, language, controller.signal)
      .then(result => { if (!controller.signal.aborted) setEntry(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Dictionary lookup failed'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, language, retry]);

  async function askAI() {
    const current = generation.current;
    setAsking(true); setError('');
    try {
      // This click handler is the only AI request path in this component.
      const result = await enrichWord(selection, language);
      if (current === generation.current) setAiEntry(result);
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'AI is unavailable');
    } finally { if (current === generation.current) setAsking(false); }
  }

  async function save() {
    const current = generation.current;
    setSaving(true); setError(''); setNotice('');
    try {
      const existing = await fetchWords();
      const normalized = selection.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
      const match = existing.find(word => word.word.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase() === normalized && word.language === language);
      if (match) {
        if (current === generation.current) setNotice('Already in your Vocabulary. Your notes and review progress were preserved.');
        return;
      }
      const details: Partial<VocabularyWord> = aiEntry || {
        ipa: entry?.ipa, pos: entry?.pos, translation: entry?.translation,
        definition: entry?.definitions.join('\n'), collocations: entry?.collocations,
      };
      await createWord({ ...details, word: selection, language,
        collection: collectionId || '',
        source: `${aiEntry ? 'AI (requested by user)' : (entry?.sources.map(source => source.name).join(', ') || 'Manual')}\n${context || ''}`.trim(),
        examples: context ? [{ sentence: context, translation: '' }] : details.examples || [],
      });
      if (current === generation.current) { setNotice('Saved to Vocabulary. Ready for active recall in Review.'); onSaved?.(); }
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not save. Retry when connected.');
    } finally { if (current === generation.current) setSaving(false); }
  }

  const translation = aiEntry?.translation || entry?.translation;
  const definitions = aiEntry?.definition ? [aiEntry.definition] : entry?.definitions || [];
  const collocations = aiEntry?.collocations || entry?.collocations || [];

  return <aside aria-label="Dictionary" className="rounded-2xl border border-border bg-card p-5 space-y-5 min-w-0">
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"><BookOpen size={16} /> Local dictionary</div>
    {!selection ? <p className="text-sm text-muted-foreground">Select a word or expression in the article to explore its meaning.</p> : <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><h2 className="text-2xl font-semibold break-words">{selection}</h2>
          {(aiEntry?.ipa || entry?.ipa) && <p className="text-sm text-muted-foreground mt-1">{aiEntry?.ipa || entry?.ipa}</p>}
          <p className="text-xs text-muted-foreground mt-1">{aiEntry?.pos || entry?.pos}</p>
        </div>
        <button type="button" aria-label={`Pronounce ${selection}`} onClick={() => speakWord(selection, language)} className="rounded-lg p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><Volume2 size={18} /></button>
      </div>
      {entry?.lemma && entry.lemma.toLocaleLowerCase() !== selection.toLocaleLowerCase() && <p className="text-xs text-muted-foreground">Base form: <strong>{entry.lemma}</strong></p>}
      {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" /> Looking up locally…</p>}
      {entry && !entry.found && !aiEntry && <div className="rounded-xl bg-muted p-3 text-sm"><p>Not found in local dictionary</p>{entry.notice && <p className="mt-2 text-xs text-muted-foreground">{entry.notice}</p>}</div>}
      {aiEntry && <p className="text-xs font-medium text-amber-700">AI result · requested by you · may contain mistakes</p>}
      {translation && <p className="text-base whitespace-pre-line">{translation}</p>}
      {definitions.length > 0 && <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed">{definitions.map((definition, index) => <li key={index}>{definition}</li>)}</ol>}
      {collocations.length > 0 && <div><h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Expressions</h3>
        <div className="flex flex-wrap gap-2">{collocations.map(phrase => <button type="button" key={phrase} onClick={() => setSelectedPhrase(phrase)} className="text-xs rounded-lg border border-border px-2 py-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">{phrase}</button>)}</div>
      </div>}
      {selectedPhrase && <button type="button" onClick={() => setSelectedPhrase('')} className="text-xs underline">Back to {query}</button>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving || loading || asking} className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">{saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Save to Vocabulary</button>
        <button type="button" onClick={askAI} disabled={asking || loading || saving} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">{asking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Ask AI</button>
      </div>
      <p className="text-xs text-muted-foreground">Ask AI sends this expression to the configured AI service. Ordinary lookup makes no AI requests.</p>
      {entry?.sources.length ? <div className="border-t border-border pt-3 space-y-1 text-xs text-muted-foreground">{entry.sources.map(source => <p key={source.name}><a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.name}</a> · <a href={source.license_url} target="_blank" rel="noreferrer" className="underline">{source.license}</a></p>)}</div> : null}
    </>}
    {error && <div role="alert" className="text-sm text-rose-700 bg-rose-50 rounded-xl p-3 space-y-2"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Retry local lookup</button></div>}
    {notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}
  </aside>;
}
