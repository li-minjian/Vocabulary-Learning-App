import { fetchApi } from './api';

export interface DictionarySource {
  name: string;
  url: string;
  license: string;
  license_url: string;
}

export interface DictionaryEntry {
  query: string;
  language: string;
  found: boolean;
  installed: boolean;
  cached: boolean;
  resolution: 'exact' | 'form' | 'suffix' | 'miss';
  word: string;
  lemma: string;
  ipa: string;
  pos: string;
  translation: string;
  definitions: string[];
  collocations: string[];
  sources: DictionarySource[];
  source: DictionarySource | null;
  message?: string;
  notice?: string;
}

// No AI fallback: a local miss is a successful response with found=false.
export function lookupDictionary(query: string, language: string, signal?: AbortSignal) {
  return fetchApi<DictionaryEntry>(`/api/dictionary?q=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}`, { signal });
}

export interface DictionaryPhraseSpan { start: number; end: number; text: string }

export async function findDictionaryPhrases(text: string, language: string, signal?: AbortSignal) {
  const response = await fetchApi<{ items: DictionaryPhraseSpan[] }>('/api/dictionary/phrases', {
    method: 'POST', body: JSON.stringify({ text, language }), signal,
  });
  // Offsets use Unicode code points, matching TypingSurface's Array.from(text).
  return response.items;
}
