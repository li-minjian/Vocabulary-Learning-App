import { useState } from 'react';
import { Loader2, MoreVertical } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from './ui/alert-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { announceVocabularyChange, clearVocabulary, deleteVocabularyBatch, downloadVocabularyBackup, prepareVocabularyClear, type VocabularyBackup } from '../../lib/vocabularyManagement';

const button = 'min-h-10 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50';
export function VocabularyManagement({ selectedIds, onRefresh, onClearSelection }: {
  selectedIds: string[]; onRefresh: () => Promise<void>; onClearSelection: () => void;
}) {
  const [mode, setMode] = useState<'batch' | 'clear' | null>(null);
  const [backup, setBackup] = useState<VocabularyBackup | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const close = () => { if (!busy) { setMode(null); setError(''); setConfirmation(''); } };
  async function prepare() {
    setBusy(true); setError(''); setBackup(null);
    try { setBackup(await prepareVocabularyClear()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Backup could not be verified.'); }
    finally { setBusy(false); }
  }
  async function run() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'batch') {
        const targetIds = [...selectedIds]; let deleted = 0;
        for (let start = 0; start < targetIds.length; start += 200) {
          const result = await deleteVocabularyBatch(targetIds.slice(start, start + 200));
          deleted += result.deleted; setProgress(`${deleted} deletions verified`);
          if (!result.complete) throw new Error('Some selected words or their learning data remain. Refresh and retry the remaining selection.');
        }
        setNotice(`${deleted} selected words deleted and verified.`); onClearSelection();
      } else {
        if (!backup?.verified || confirmation !== 'DELETE ALL VOCABULARY') return;
        let remaining = backup.counts.words; let removed = 0;
        do {
          const result = await clearVocabulary(backup.backup_id, confirmation);
          removed = result.removed; setProgress(`${removed} deleted · ${result.remaining} remaining`);
          if (!result.preserved || !result.batch_complete) throw new Error('Clear is incomplete. Your backup is retained. Retry to reconcile remaining words.');
          if (result.complete) { remaining = 0; break; }
          if (result.remaining >= remaining) throw new Error('Library changed or deletion made no progress. Create a fresh backup before continuing.');
          remaining = result.remaining;
        } while (remaining > 0);
        setNotice(`${removed} words removed. Server verified an empty library and preserved Collections, Articles and tags. Private backup: ${backup.backup_id}`);
        onClearSelection();
      }
      setMode(null); setConfirmation('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Deletion could not be verified. Refresh before retrying.'); }
    finally {
      announceVocabularyChange();
      try { await onRefresh(); } catch { setError('Refresh failed. Reload the library to reconcile its current state.'); }
      setBusy(false); setProgress('');
    }
  }
  return <>
    <div className="flex flex-wrap items-center gap-2">
      {!!selectedIds.length && <button className={`${button} border-rose-200 text-rose-700`} disabled={busy} onClick={() => { setMode('batch'); setError(''); }}>Delete selected</button>}
      <DropdownMenu><DropdownMenuTrigger asChild><button className={button} aria-label="Vocabulary management"><MoreVertical size={18} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setMode('clear'); setError(''); setBackup(null); setConfirmation(''); }}>Clear entire Vocabulary Library</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>
    {notice && <p role="status" className="w-full break-words rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}
    <AlertDialog open={mode !== null} onOpenChange={open => { if (!open) close(); }}><AlertDialogContent className="max-h-[90vh] overflow-y-auto bg-white">
      <AlertDialogHeader><AlertDialogTitle>{mode === 'batch' ? `Delete ${selectedIds.length} selected words?` : 'Clear entire Vocabulary Library'}</AlertDialogTitle><AlertDialogDescription>
        {mode === 'batch' ? 'The selected words and their vocabulary-specific learning data, examples and word-tag links will be removed.' : 'This removes all your vocabulary, including words in Collections, and vocabulary-specific SRS history. Collection folders, Articles, account, settings, tags, dictionary datasets and other accounts are preserved.'}
      </AlertDialogDescription></AlertDialogHeader>
      {mode === 'clear' && <div className="space-y-3 text-sm">
        <p>Backup status: {backup?.verified ? 'Created and verified in private storage' : 'Not created. Deletion is blocked.'}</p>
        <button className={button} disabled={busy} onClick={prepare}>{backup ? 'Create fresh backup' : 'Back up & inspect my library'}</button>
        {backup && <><p><strong>{backup.counts.words} words</strong> · {backup.collections_with_words} Collections contain words.</p><p>Relations backed up: {['examples', 'collocations', 'synonyms', 'word_tags'].map(name => `${name}: ${backup.counts[name]}`).join(' · ')}</p><p className="break-all text-xs">{backup.created_at} · SHA-256: {backup.sha256}</p><button className="underline" disabled={busy} onClick={() => { void downloadVocabularyBackup(backup.backup_id).catch(cause => setError(cause instanceof Error ? cause.message : 'Backup download failed.')); }}>Download my private backup</button><label className="block" htmlFor="clear-confirmation">Type DELETE ALL VOCABULARY<input id="clear-confirmation" autoComplete="off" className="mt-2 w-full rounded-xl border p-3" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label></>}
      </div>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />{progress || 'Verifying…'}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={close}>Cancel</AlertDialogCancel><button className={`${button} border-rose-200 bg-rose-50 text-rose-700`} disabled={busy || (mode === 'clear' && (!backup?.verified || confirmation !== 'DELETE ALL VOCABULARY')) || (mode === 'batch' && !selectedIds.length)} onClick={run}>{mode === 'batch' ? 'Confirm deletion' : 'Clear my vocabulary'}</button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
