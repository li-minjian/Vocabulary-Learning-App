import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { getExercise, getExerciseSession, answerExercise, rateExercise, endExerciseSession, startExerciseSession, type SessionDetail, type Attempt } from '../../lib/exercises';
const button = 'min-h-11 rounded-xl bg-[#002434] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50';
export function ExercisePractice() {
  const {
    sessionId
  } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [end, setEnd] = useState(false);
  const [past, setPast] = useState<Awaited<ReturnType<typeof getExercise>> | null>(null);
  const [pastIndex, setPastIndex] = useState(0);
  const answerId = useRef(crypto.randomUUID());
  const focus = useRef<HTMLInputElement | null>(null);
  function adopt(r: SessionDetail) {
    setData(r);
    setAttempt(r.attempt);
    setAnswers(r.attempt?.answers || []);
    answerId.current = crypto.randomUUID();
    setPast(null);
  }
  useEffect(() => {
    let live = true;
    void getExerciseSession(sessionId!).then(r => {
      if (live) adopt(r);
    }).catch(e => {
      if (live) setError(e.message);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);
  useEffect(() => {
    focus.current?.focus();
  }, [data?.current?.id]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Progress was not confirmed. Retry; the same answer will not be counted twice.');
    } finally {
      setBusy(false);
    }
  }
  async function check(revealed = false) {
    if (!data?.current) return;
    await action(async () => setAttempt(await answerExercise(sessionId!, {
      id: answerId.current,
      exercise_id: data.current!.id,
      answers,
      revealed
    })));
  }
  async function previous(index: number) {
    if (!data) return;
    await action(async () => {
      setPast(await getExercise(data.session.exercise_ids[index]));
      setPastIndex(index);
    });
  }
  async function rate(rating: string) {
    if (!data?.current) return;
    await action(async () => adopt(await rateExercise(sessionId!, data.current!.id, rating)));
  }
  const current = data?.current;
  const doc = current?.document;
  const finished = data && data.session.status !== 'active';
  return <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
  <header><Link to="/exercises" className="text-sm underline">Exercise Library · progress saved</Link><h1 className="mt-3 text-2xl font-bold">{finished ? 'Session results' : 'Exercise practice'}</h1></header>
  {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={() => void action(async () => adopt(await getExerciseSession(sessionId!)))}>Reload saved progress</button></p>}
  {!data && !error && <p role="status">Loading your saved session…</p>}
  {data && <><p className="text-sm">{data.session.position} / {data.session.exercise_ids.length} completed</p><progress aria-label="Session progress" className="w-full" value={data.session.position} max={data.session.exercise_ids.length} /></>}
  {data && !finished && doc && current && <article className="space-y-5 rounded-2xl border bg-white p-5 sm:p-8" aria-label="Practice question">
   <p className="text-sm text-slate-600">{current.category} {current.unit} · {current.source_deck}</p><p className="font-semibold">{doc.instruction}</p>
   <form onSubmit={e => {
        e.preventDefault();
        if (!attempt && !busy && doc.mode !== 'self_assess') void check();
      }} className="space-y-5">
    <div className="text-lg leading-loose" data-testid="practice-prompt">{doc.segments.map((segment, i) => 'text' in segment ? <span key={i}>{segment.text}</span> : <label key={i} className="mx-1 inline-flex max-w-full flex-col align-middle"><span className="sr-only">Blank {segment.blank + 1}</span><input ref={segment.blank === 0 ? focus : undefined} aria-label={`Blank ${segment.blank + 1}`} autoComplete="off" maxLength={2000} className="min-h-11 w-40 max-w-full rounded-lg border border-teal-700 bg-teal-50 px-3 text-base" disabled={!!attempt || busy} value={answers[segment.blank] || ''} onChange={e => setAnswers(previous => {
              const next = [...previous];
              next[segment.blank] = e.target.value;
              return next;
            })} />{current.hints?.[segment.blank] && <span className="text-xs text-slate-600">Hint: {current.hints[segment.blank]}</span>}</label>)}</div>
    {doc.mode === 'self_assess' && <label className="block text-sm">Your answer (optional)<textarea className="mt-2 w-full rounded-xl border p-3" maxLength={2000} value={answers[0] || ''} disabled={!!attempt || busy} onChange={e => setAnswers([e.target.value])} /></label>}
    {doc.options && <fieldset><legend>Choose your answer</legend>{doc.options.map(v => <label key={v} className="mr-4 inline-flex gap-2"><input type="radio" name="choice" checked={answers[0] === v} disabled={!!attempt || busy} onChange={() => setAnswers([v])} />{v}</label>)}</fieldset>}
    {doc.choices && <details><summary className="cursor-pointer text-sm font-semibold">Show source choices / hints</summary><p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{doc.choices}</p></details>}
    {doc.warnings.map(w => <p key={w} className="text-sm text-amber-800">{w}</p>)}
    {!attempt && <div className="flex flex-wrap gap-3">{doc.mode !== 'self_assess' && <button type="submit" className={button} disabled={busy}>Check answer &amp; save</button>}<button type="button" className="min-h-11 rounded-xl border px-4 text-sm" disabled={busy} onClick={() => void check(true)}>Show answer / self-assess</button><button type="button" className="min-h-11 px-3 text-sm underline" disabled={busy} onClick={() => void action(async () => {
            await answerExercise(sessionId!, {
              id: answerId.current,
              exercise_id: current.id,
              answers: [],
              revealed: true
            });
            adopt(await rateExercise(sessionId!, current.id, 'skip'));
          })}>Skip exercise</button></div>}
   </form>
   {attempt && <section aria-label="Answer feedback" className="space-y-3 rounded-xl border border-teal-300 bg-teal-50 p-4"><h2 className="text-xl font-bold" role="status">{attempt.revealed ? 'Answer revealed — self-assess' : attempt.correct === true ? 'Correct' : attempt.correct === false ? 'Incorrect' : 'Self-assessment needed'}</h2><p>Your answer: {attempt.answers.join(' · ') || 'No answer submitted'}</p><p>Expected: {attempt.result.expected.map(a => a.join(' / ')).join(' · ')}</p><p>{attempt.result.completed}</p>{attempt.result.explanation && <p>{attempt.result.explanation}</p>}<p className="text-sm">Answer saved. Choose a rating to schedule the next review and continue.</p><div className="flex flex-wrap gap-2">{['again', 'hard', 'good', 'easy'].map(r => <button key={r} disabled={busy} className={button} onClick={() => void rate(r)}>{r[0].toUpperCase() + r.slice(1)} · Next</button>)}</div></section>}
  </article>}
  {data && !finished && !current && <p role="alert">This exercise was removed. End this session and start a new queue.</p>}
  {data && finished && <section className="space-y-4 rounded-2xl border bg-white p-6"><h2 className="text-xl font-bold">Your saved results</h2><dl className="grid grid-cols-2 gap-3">{Object.entries(data.summary).map(([key, value]) => <div key={key}><dt className="text-sm text-slate-600">{key.replaceAll('_', ' ')}</dt><dd className="text-xl font-bold">{value === null ? '—' : key === 'accuracy' ? `${value}%` : value}</dd></div>)}</dl><p className="text-sm">Accuracy uses checked answers only. Revealed and skipped answers are not counted as correct.</p><button className={button} disabled={busy} onClick={() => void action(async () => {
        const r = await startExerciseSession({
          ...data.session.config,
          mode: 'due'
        });
        navigate(`/exercises/session/${r.session.id}`);
      })}>Review due exercises</button><button className="ml-3 underline" disabled={busy} onClick={() => void action(async () => {
        const r = await startExerciseSession(data.session.config);
        navigate(`/exercises/session/${r.session.id}`);
      })}>Restart with a new session</button><Link to="/exercises" className="block underline">Back to Exercise Library</Link></section>}
  {data && !finished && <div className="space-y-3"><Link className="inline-flex min-h-11 items-center underline" to="/exercises">Pause — resume later</Link><button className="ml-4 underline" onClick={() => setEnd(true)}>End session</button>{end && <div className="rounded-xl border p-4"><p>Finish now? Submitted answers stay saved.</p><button className={`${button} mt-3`} disabled={busy} onClick={() => void action(async () => adopt(await endExerciseSession(sessionId!)))}>Finish session &amp; show results</button><button className="ml-3 underline" onClick={() => setEnd(false)}>Continue practicing</button></div>}{data.session.position > 0 && <button className="block underline" disabled={busy} onClick={() => void previous(data.session.position - 1)}>Previous completed exercise</button>}{past && <article className="space-y-3 rounded-xl border bg-white p-4"><h2 className="font-bold">Completed exercise {pastIndex + 1}</h2><p>{past.exercise.document.question}</p>{past.history.filter(a => a.session_id === sessionId).map(a => <p key={a.id}>Your answer: {a.answers.join(' · ')} · {a.rating || 'Awaiting rating'}</p>)}<p>Expected: {past.exercise.document.expected.map(a => a.join(' / ')).join(' · ')}</p><button disabled={busy || pastIndex === 0} className="mr-3 underline" onClick={() => void previous(pastIndex - 1)}>Previous</button><button disabled={busy || pastIndex >= data.session.position - 1} className="mr-3 underline" onClick={() => void previous(pastIndex + 1)}>Next completed</button><button className="underline" onClick={() => setPast(null)}>Return to current exercise</button></article>}</div>}
 </div>;
}
