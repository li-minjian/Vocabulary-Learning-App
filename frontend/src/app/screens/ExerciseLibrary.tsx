import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { listExerciseSets, getExerciseSet, renameExerciseSet, deleteExerciseSet, getExercise, deleteExercise, type ExerciseSet, type ExerciseItem, type Attempt } from '../../lib/exercises';
const box = 'rounded-2xl border border-border bg-white p-5';
const btn = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-[#002434] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const input = 'min-h-11 max-w-full rounded-xl border bg-white px-3 py-2 text-sm';
export function ExerciseLibrary({ collection = 'all' }: { collection?: string }) {
  const {
    setId
  } = useParams();
  const navigate = useNavigate();
  const importReport=useLocation().state?.exerciseImport as Record<string,number>|undefined;
  const [sets, setSets] = useState<ExerciseSet[]>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getExerciseSet>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      const [s, d] = await Promise.all([listExerciseSets(), setId ? getExerciseSet(setId, offset, {
        category,
        unit,
        source_deck: deck
      }) : Promise.resolve(null)]);
      setSets(s.items.filter(s=>collection==='all'||(collection==='unassigned'?!s.collection_id:s.collection_id===collection)));
      setDetail(d);
      setRename(d?.set.title || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load exercises.');
    }
  }, [setId, offset, category, unit, deck, collection]);
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
  const learnQuery = new URLSearchParams({method:'exercises',...(setId?{set:setId}:{}),...(detail?.set.collection_id?{collection:detail.set.collection_id}:collection!=='all'?{collection}:{}),category,unit,deck});
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
  <header className="space-y-2"><Link to="/library?type=exercises" className="text-sm underline">Exercise Library</Link><h1 className="text-3xl font-bold text-[#002434]">{detail?.set.title || 'Exercises'}</h1><p className="text-sm text-slate-600">Study questions and grammar exercises. Your answers and review progress are saved separately from Vocabulary.</p></header>
  {importReport&&<p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4">{importReport.imported||0} exercises saved · {importReport.unchanged||0} unchanged · {importReport.conflict||0} conflicts · {importReport.unsupported||0} unsupported. Configure practice in Learn.</p>}
  {detail?.set.collection_id&&<Link className="text-sm underline" to={`/collections/${detail.set.collection_id}`}>Open Collection destination</Link>}
  {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}
  {detail&&<section className={`${box} space-y-4`} aria-label="Browse filters"><div className="flex flex-wrap gap-3">{([['Category',category,setCategory,detail.categories],['Unit',unit,setUnit,detail.units],['Source deck',deck,setDeck,detail.decks]] as const).map(([label,value,setter,options])=><label key={label} className="min-w-0 text-sm">{label}<select className={`${input} ml-2`} value={value} onChange={e=>{setOffset(0);setter(e.target.value);}}><option value="">All</option>{options.map(v=><option key={v}>{v}</option>)}</select></label>)}</div><div className="flex flex-wrap gap-3"><Link className={btn} to={`/learn?${learnQuery}`}>{unit?'Practice this unit':'Practice this set'}</Link><Link className="py-3 text-sm underline" to={`/learn?${new URLSearchParams({...Object.fromEntries(learnQuery),method:'review',scope:'exercises'})}`}>Review due exercises</Link></div></section>}
  {!setId && <section className="grid gap-4 sm:grid-cols-2">{sets.map(s => <article key={s.id} className={`${box} space-y-3`}><h2 className="text-xl font-bold"><Link to={`/exercises/${s.id}`}>{s.title}</Link></h2><p className="text-sm text-slate-600">{s.content_types?.map(kind=>kind.replaceAll('_',' ')).join(' · ')}</p><p>{s.count} exercises · {s.completed} practiced · {s.due} due</p><progress aria-label={`${s.title} progress`} className="w-full" value={s.completed} max={s.count || 1} /><p className="text-xs text-slate-600">{s.source_filename} · Last practice: {s.last_practiced ? new Date(s.last_practiced).toLocaleString() : 'Not yet'}</p><Link className={btn} to={`/exercises/${s.id}`}>Open set</Link> <Link className="text-sm underline" to={`/learn?method=exercises&set=${s.id}${s.collection_id?`&collection=${s.collection_id}`:""}`}>Practice this set</Link></article>)}{!sets.length && <div className={box}><p>No Exercise Sets saved yet.</p><Link to="/import/files" className={`${btn} mt-3`}>Import an Anki exercise file</Link></div>}</section>}
  {detail && <>
   <section className={`${box} space-y-3`}><h2 className="text-xl font-bold">Browse exercises · {detail.count}</h2><p className="text-sm">Category, Unit and Source deck filters above narrow this list. Practice these items through Learn.</p>{detail.items.map((item, i) => <button key={item.id} disabled={busy} className="block w-full rounded-xl border p-3 text-left hover:bg-teal-50" onClick={() => void action(async () => {
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
