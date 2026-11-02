import { fetchApi } from './api';
const root = '/api/vocabulary-management';
export interface VocabularyBackup {
  backup_id: string; created_at: string; sha256: string; location: string; verified: boolean;
  counts: Record<string, number>; collections_with_words: number;
}
export interface ClearResult { removed: number; remaining: number; complete: boolean; batch_complete: boolean; preserved: boolean }
export interface DeleteResult { deleted: number; remaining_ids: string[]; complete: boolean }
export const deleteVocabularyBatch = (ids: string[]) => fetchApi<DeleteResult>(`${root}/batch-delete`, { method: 'POST', body: JSON.stringify({ ids }) });
export const prepareVocabularyClear = () => fetchApi<VocabularyBackup>(`${root}/clear/prepare`, { method: 'POST' });
export const clearVocabulary = (backup_id: string, confirmation: string) => fetchApi<ClearResult>(`${root}/clear`, { method: 'POST', body: JSON.stringify({ backup_id, confirmation }) });
export async function downloadVocabularyBackup(id: string) {
  const backup = await fetchApi<unknown>(`${root}/backups/${encodeURIComponent(id)}`);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `voca-vocabulary-backup-${id}.json`; link.click(); URL.revokeObjectURL(url);
}
export function announceVocabularyChange() {
  // Other tabs can invalidate immediately; screens also fetch fresh data on mount.
  localStorage.setItem('voca:vocabulary-changed', String(Date.now()));
  window.dispatchEvent(new Event('voca:vocabulary-changed'));
}
