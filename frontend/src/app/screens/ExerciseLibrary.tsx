import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { listExerciseSets, getExerciseSet, listExerciseSessions, startExerciseSession, renameExerciseSet, deleteExerciseSet, getExercise, deleteExercise, type ExerciseSet, type StudySession, type ExerciseItem, type Attempt } from '../../lib/exercises';
const box = 'rounded-2xl border border-border bg-white p-5';
const btn = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-[#002434] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const input = 'min-h-11 max-w-full rounded-xl border bg-white px-3 py-2 text-sm';
export function ExerciseLibrary() {
  const {
    setId
  } = useParams();
  const navigate = useNavigate();
  const importReport=useLocation().state?.exerciseImport as Record<string,number>|undefined;
  const [sets, setSets] = useState<ExerciseSet[]>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getExerciseSet>> | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('all');
  const [limit, setLimit] = useState(20);
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [deck, setDeck] = useState('');
  const [offset, setOffset] = useState(0);
  const [rename, setRename] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [selected, setSelected] = useState<{
    exercise: ExerciseItem;
    history: Attempt[];
  } | null>(null);
  const [deleteItem, setDeleteItem] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const [s, r, d] = await Promise.all([listExerciseSets(), listExerciseSessions(), setId ? getExerciseSet(setId, offset, {
        category,
        unit,
        source_deck: deck
      }) : Promise.resolve(null)]);
      setSets(s.items);
      setSessions(r.items);
      setDetail(d);
      setRename(d?.set.title || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load exercises.');
    }
  }, [setId, offset, category, unit, deck]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setOffset(0);
    setCategory('');
    setUnit('');
    setDeck('');
    setSelected(null);
  }, [setId]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation was not confirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    await action(async () => {
      const r = await startExerciseSession({
        set_id: setId || null,
        mode,
        limit,
        category,
        unit,
        source_deck: deck
      });
      navigate(`/exercises/session/${r.session.id}`);
    });
  }
  const active = sessions.filter(s => s.status === 'active' && (!setId || s.config.set_id === setId));
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
  <header className="space-y-2"><Link to="/exercises" className="text-sm underline">Exercise Library</Link><h1 className="text-3xl font-bold text-[#002434]">{detail?.set.title || 'Exercises'}</h1><p className="text-sm text-slate-600">Study questions and grammar exercises. Your answers and review progress are saved separately from Vocabulary.</p></header>
  {importReport&&<p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4">{importReport.imported||0} exercises saved · {importReport.unchanged||0} unchanged · {importReport.conflict||0} conflicts · {importReport.unsupported||0} unsupported. Start practicing below.</p>}
  {detail?.set.collection_id&&<Link className="text-sm underline" to={`/collections/${detail.set.collection_id}`}>Open Collection destination</Link>}
  {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}
  <section className={`${box} space-y-4`} aria-label="Practice settings"><h2 className="text-xl font-bold">Practice exercises</h2><div className="flex flex-wrap gap-3">
   <label className="text-sm">Queue<select className={`${input} ml-2`} value={mode} onChange={e => setMode(e.target.value)}><option value="all">All exercises</option><option value="new">New exercises</option><option value="due">Due review</option></select></label>
   <label className="text-sm">Session size<input aria-label="Session size" className={`${input} ml-2 w-24`} type="number" min={1} max={200} value={limit} onChange={e => setLimit(Number(e.target.value))} /></label>
   {detail && <>{[['Category', category, setCategory, detail.categories], ['Unit', unit, setUnit, detail.units], ['Source deck', deck, setDeck, detail.decks]].map(([label, value, setter, values]) => <label key={String(label)} className="min-w-0 text-sm">{String(label)}<select aria-label={String(label)} className={`${input} ml-2`} value={String(value)} onChange={e => {
              setOffset(0);
              (setter as (v: string) => void)(e.target.value);
            }}><option value="">All</option>{(values as string[]).map(v => <option key={v}>{v}</option>)}</select></label>)}</>}
  </div><button className={btn} disabled={busy || !sets.length || limit < 1 || limit > 200} onClick={start}>{mode === 'due' ? 'Review due exercises' : 'Start practicing'}</button><p className="text-xs text-slate-600">New VOCA schedule. Again: 10 minutes; Hard / Good / Easy: 1 / 3 / 5 days × attempts. Choose the rating yourself after checking.</p></section>
  {!!active.length && <section className={`${box} space-y-2`}><h2 className="text-lg font-bold">Resume a session</h2>{active.slice(0, 5).map(s => <Link key={s.id} to={`/exercises/session/${s.id}`} className="block underline">Resume · {s.position}/{s.exercise_ids.length} completed · {new Date(s.updated_at).toLocaleString()}</Link>)}</section>}
  {!setId && <section className="grid gap-4 sm:grid-cols-2">{sets.map(s => <article key={s.id} className={`${box} space-y-3`}><h2 className="text-xl font-bold"><Link to={`/exercises/${s.id}`}>{s.title}</Link></h2><p className="text-sm text-slate-600">{s.content_types?.map(kind=>kind.replaceAll('_',' ')).join(' · ')}</p><p>{s.count} exercises · {s.completed} practiced · {s.due} due</p><progress aria-label={`${s.title} progress`} className="w-full" value={s.completed} max={s.count || 1} /><p className="text-xs text-slate-600">{s.source_filename} · Last practice: {s.last_practiced ? new Date(s.last_practiced).toLocaleString() : 'Not yet'}</p><Link className={btn} to={`/exercises/${s.id}`}>Open set</Link></article>)}{!sets.length && <div className={box}><p>No Exercise Sets saved yet.</p><Link to="/import/files" className={`${btn} mt-3`}>Import an Anki exercise file</Link></div>}</section>}
  {detail && <>
   <section className={`${box} space-y-3`}><h2 className="text-xl font-bold">Browse exercises · {detail.count}</h2><p className="text-sm">Category, Unit and Source deck filters above apply to browsing and practice queues.</p>{detail.items.map((item, i) => <button key={item.id} disabled={busy} className="block w-full rounded-xl border p-3 text-left hover:bg-teal-50" onClick={() => void action(async () => {
          setSelected(await getExercise(item.id));
          setDeleteItem(false);
        })}><span className="text-sm text-slate-600">{offset + i + 1}. {item.category} {item.unit} · {item.learning_state}</span><span className="mt-1 block">{item.document.question}</span></button>)}<div className="flex gap-3"><button className={input} disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 50))}>Previous page</button><button className={input} disabled={offset + 50 >= detail.count} onClick={() => setOffset(n => n + 50)}>Next page</button></div></section>
   {selected && <section className={`${box} space-y-3`} aria-label="Exercise details"><button className="underline" onClick={() => setSelected(null)}>Close details</button><p>{selected.exercise.document.instruction}</p><h2 className="text-xl font-bold">{selected.exercise.document.question}</h2><details><summary className="cursor-pointer font-semibold">Show expected answer</summary><p>{selected.exercise.document.expected.map(a => a.join(' / ')).join(' · ')}</p><p>{selected.exercise.document.completed}</p>{selected.exercise.document.explanation && <p>{selected.exercise.document.explanation}</p>}</details><p className="text-sm">{selected.exercise.total_attempts} attempts · {selected.exercise.correct_attempts} correct</p><h3 className="font-bold">Recent attempts</h3>{selected.history.map(a => <p key={a.id} className="text-sm">{new Date(a.created_at).toLocaleString()} · {a.revealed ? 'Revealed' : a.correct === true ? 'Correct' : a.correct === false ? 'Incorrect' : 'Self-assessed'} · {a.answers.join(' · ')} · {a.rating || 'Awaiting rating'}</p>)}
    {!deleteItem ? <button className="text-red-700 underline" onClick={() => setDeleteItem(true)}>Delete this exercise</button> : <div className="rounded-xl bg-red-50 p-3"><p>This deletes this exercise and its attempt history. Vocabulary is unaffected.</p><button disabled={busy} className={btn} onClick={() => void action(async () => {
            const r = await deleteExercise(selected.exercise.id);
            if (!r.deleted) throw new Error('Deletion was not confirmed.');
            setSelected(null);
            await load();
          })}>Confirm delete exercise and history</button><button className="ml-3 underline" onClick={() => setDeleteItem(false)}>Cancel</button></div>}
   </section>}
   <details className={`${box} space-y-3`}><summary className="cursor-pointer font-semibold">Manage Exercise Set</summary><label className="mt-3 block text-sm">Set title<input className={`${input} ml-2`} value={rename} maxLength={200} onChange={e => setRename(e.target.value)} /></label><button className={`${btn} mt-3`} disabled={busy || !rename.trim()} onClick={() => void action(async () => {
          await renameExerciseSet(setId!, rename);
          await load();
        })}>Rename set</button><button className="ml-4 text-red-700 underline" onClick={() => setDeleting(true)}>Delete set</button>{deleting && <div className="mt-3 space-y-3 rounded-xl bg-red-50 p-4"><p>Deleting this set removes its exercises and their attempt history. Vocabulary and Collections remain. Type “{detail.set.title}” to confirm.</p><input aria-label="Confirm set title" className={input} value={confirm} onChange={e => setConfirm(e.target.value)} /><button className={`${btn} ml-3`} disabled={busy || confirm !== detail.set.title} onClick={() => void action(async () => {
            await deleteExerciseSet(setId!, confirm);
            navigate('/exercises');
          })}>Confirm delete set and history</button><button className="ml-3 underline" onClick={() => setDeleting(false)}>Cancel</button></div>}</details>
  </>}
 </div>;
}
