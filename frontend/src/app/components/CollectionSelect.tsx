import type { Collection } from '../../lib/api';
export function CollectionSelect({collections,value,onChange,disabled=false}: {collections: Collection[];value: string;onChange: (id: string)=>void;disabled?: boolean}) {
 return <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Collection<select aria-label="Collection" className="min-h-11 max-w-full rounded-xl border bg-white px-3 py-2 disabled:opacity-50" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>
 <option value="all">All Collections</option><option value="unassigned">Unassigned</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>;
}
