import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ParsedList } from '../../lib/fileImport';
import { exerciseNotes, type GroupConfig } from '../../lib/importMapping';
import { listExerciseSets, previewExercises, createExerciseSet, commitExercises, type ExercisePreview, type ExerciseSet } from '../../lib/exercises';
const field = 'w-full rounded-xl border bg-white p-3 text-sm';
const button = 'min-h-11 rounded-xl bg-[#002434] px-5 py-2 font-semibold text-white disabled:opacity-50';
export function ExerciseImport({
  parsed,
  configs,
  selected,
  filename,
  collectionId,
  destinationBlocked,
  onSaving
}: {
  parsed: ParsedList;
  configs: Record<string, GroupConfig>;
  selected: Set<number>;
  filename: string;
  collectionId: string;
  destinationBlocked: boolean;
  onSaving:(busy:boolean)=>void;
}) {
  const navigate = useNavigate();
  const [sets, setSets] = useState<ExerciseSet[]>([]);
  const [setId, setSetId] = useState('');
  const [title, setTitle] = useState(filename.replace(/\.[^.]+$/, '') || 'Imported exercises');
  const [groups, setGroups] = useState(new Set(parsed.groups.filter(g => !['vocabulary', 'unresolved'].includes(g.analysis.kind)).map(g => g.id)));
  const [mediaConfirmed,setMediaConfirmed]=useState(false);
  const [preview, setPreview] = useState<ExercisePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const [savedSet, setSavedSet] = useState('');
  const [progress, setProgress] = useState(0);
  const createId = useRef(crypto.randomUUID());
  const version = useRef(0);
  const notes = useMemo(() => exerciseNotes(parsed, configs, selected, groups), [parsed, configs, selected, groups]);
  useEffect(() => {
    let live = true;
    void listExerciseSets().then(r => {
      if (live) setSets(r.items);
    }).catch(() => {
      if (live) setError('Exercise Sets could not be loaded. Retry before saving.');
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    version.current++;
    setPreview(null);
    setMediaConfirmed(false);
    setDone(null);
  }, [notes, setId, title, collectionId, destinationBlocked]);
  async function check() {
    setBusy(true);
    setError('');
    const v = version.current;
    try {
      const r = await previewExercises(notes);
      if (v === version.current) setPreview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Exercise analysis failed.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!preview||preview.items.some(i=>i.document.source.has_media)&&!mediaConfirmed) return;
    setBusy(true);
    onSaving(true);
    setError('');
    const counts: Record<string, number> = {};
    try {
      const set = setId ? sets.find(s => s.id === setId)! : await createExerciseSet({
        id: createId.current,
        title: title.trim(),
        collection_id: collectionId || null,
        source_filename: filename,
        source_digest: parsed.import_id.split(':')[0]
      });
      setSavedSet(set.id);
      const items = preview.items.filter(i => i.status === 'ready');
      for (let start = 0; start < items.length; start += 100) {
        const r = await commitExercises(set.id, items.slice(start, start + 100), parsed.import_id.split(':')[0],mediaConfirmed);
        for (const [key, value] of Object.entries(r.counts)) counts[key] = (counts[key] || 0) + value;
        setProgress(Math.min(start + 100, items.length));
        if (r.counts.failed) throw new Error('Some items were not verified. Retry the same import; saved exercises and progress will be preserved.');
      }
      for (const key of ['unchanged', 'conflict', 'unsupported']) counts[key] = (counts[key] || 0) + (preview.counts[key] || 0);
      setDone(counts);
      navigate(`/exercises/${set.id}`,{state:{exerciseImport:counts}});
    } catch (e) {
      setDone({...counts,failed:Math.max(counts.failed||0,(preview.counts.ready||0)-(counts.imported||0)-(counts.unchanged||0))});
      setError(e instanceof Error ? e.message : 'Save was not confirmed. Retry safely.');
    } finally {
      setBusy(false);
      onSaving(false);
    }
  }
  return <section aria-label="Save as Exercises" className="space-y-4 rounded-2xl border border-teal-300 bg-white p-5">
  <h2 className="text-xl font-bold">Save as Exercises</h2><p className="text-sm text-slate-600">Keep questions, cloze answers, hints and context as study cards. Exercises have their own library and review progress.</p>
  <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Exercise groups</legend>{parsed.groups.map(g => <label key={g.id} className="block text-sm"><input type="checkbox" checked={groups.has(g.id)} onChange={e => setGroups(old => {
          const next = new Set(old);
          e.target.checked ? next.add(g.id) : next.delete(g.id);
          return next;
        })} /> {g.name} · {g.count} notes / {g.native_cards || g.count} source cards</label>)}</fieldset>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Exercise Set<select className={field} value={setId} disabled={busy} onChange={e => setSetId(e.target.value)}><option value="">Create a new Exercise Set</option>{sets.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>{!setId && <label className="text-sm font-semibold">New Exercise Set title<input className={field} value={title} maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>}</div>
  <p className="text-sm">{setId ? 'The existing set keeps its current Collection.' : 'The Collection chosen below will organize this set.'} New VOCA review schedule; Anki scheduling and media are not imported. Native scripts are never executed.</p>
  {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  <button className={button} disabled={busy || !notes.length || destinationBlocked || !setId && !title.trim()} onClick={check}>{busy ? 'Working…' : 'Preview exercise import'}</button>
  {preview && <div className="space-y-3" data-testid="exercise-confirmation"><h3 className="font-bold">Confirm exercise import</h3><p>{filename} · {preview.notes} notes · {preview.cards} cards · {preview.counts.ready || 0} new studyable exercises · {preview.counts.unchanged || 0} unchanged · {preview.counts.conflict || 0} conflicts · {preview.counts.unsupported || 0} unsupported.</p>
    <p>Destination: {setId ? sets.find(s => s.id === setId)?.title : title}. Existing exercises and their review history are preserved. Conflicts are not overwritten.</p>
    {preview.items.filter(i => i.status !== 'ready' && i.status !== 'unchanged').map(i => <p key={i.id} className="text-sm text-amber-800">Source row {Number(i.document.source.position) + 1}, card {String(i.document.source.ordinal ?? 'unknown')}: {i.status} {i.document.unsupported.join(' ')}</p>)}
    <details><summary className="cursor-pointer font-semibold">Final saved card preview</summary>{preview.items.slice(0, 5).map(i => <article key={i.id} className="my-3 rounded-xl border p-4"><p>{i.document.instruction}</p><p className="font-semibold">{i.document.question}</p><p>Answer: {i.document.expected.map(a => a.join(' / ')).join(' · ')}</p>{i.document.explanation && <p>{i.document.explanation}</p>}<p className="text-sm">{i.document.category} {i.document.unit}</p>{i.document.warnings.map(w => <p key={w} className="text-sm text-amber-800">{w}</p>)}</article>)}</details>
    {preview.items.some(i=>i.document.source.has_media)&&<label className="block rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><input type="checkbox" disabled={busy} checked={mediaConfirmed} onChange={e=>setMediaConfirmed(e.target.checked)}/> I checked that text is sufficient for cards with unsupported media. <strong>{preview.items.filter(i=>i.document.source.has_media).length} cards contain omitted images/audio.</strong></label>}
    <button className={button} disabled={busy || !preview.counts.ready || preview.items.some(i=>i.document.source.has_media)&&!mediaConfirmed} onClick={save}>Confirm &amp; save exercises</button>{busy && <p role="status">Verified {progress} / {preview.counts.ready || 0}</p>}
  </div>}
  {done && <div role="status" className="space-y-3"><p>{done.imported || 0} exercises saved · {done.unchanged || 0} unchanged · {done.conflict || 0} conflicts · {done.unsupported || 0} unsupported · {done.failed || 0} unverified.</p>{savedSet && <><button className={button} onClick={() => navigate(`/exercises/${savedSet}`)}>Open saved Exercise Set / Start practicing</button>{error && <button className="ml-3 underline" disabled={busy} onClick={save}>Retry same import</button>}</>}</div>}
 </section>;
}
