import { useEffect, useState } from 'react';
/** Invalidate vocabulary-derived views after management, including other tabs. */
export function useVocabularyVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion(value => value + 1);
    const storage = (event: StorageEvent) => { if (event.key === 'voca:vocabulary-changed') refresh(); };
    window.addEventListener('voca:vocabulary-changed', refresh);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('voca:vocabulary-changed', refresh); window.removeEventListener('storage', storage); };
  }, []);
  return version;
}
