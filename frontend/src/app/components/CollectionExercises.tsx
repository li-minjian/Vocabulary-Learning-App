import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listExerciseSets, type ExerciseSet } from '../../lib/exercises';
export function CollectionExercises({
  collectionId
}: {
  collectionId: string;
}) {
  const [sets, setSets] = useState<ExerciseSet[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void listExerciseSets().then(r => {
      if (live) setSets(r.items.filter(s => s.collection_id === collectionId));
    }).catch(() => {
      if (live) setError('Exercise counts could not be loaded.');
    });
    return () => {
      live = false;
    };
  }, [collectionId]);
  return <section className="space-y-2 rounded-2xl border bg-white p-5"><h2 className="font-bold">Exercises: {sets ? sets.reduce((n, s) => n + s.count, 0) : '…'}</h2>{error && <p role="alert">{error}</p>}<p className="text-sm text-slate-600">Exercise Sets have independent practice and review progress. Deleting this Collection keeps its sets in the Exercise Library.</p>{sets?.map(s => <Link key={s.id} to={`/exercises/${s.id}`} className="block underline">{s.title} · {s.count} exercises · {s.due} due</Link>)}</section>;
}
