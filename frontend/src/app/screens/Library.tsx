import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { fetchCollections, type Collection } from '../../lib/api';
import { ArticleLibrary } from '../components/ArticleLibrary';
import { CollectionSelect } from '../components/CollectionSelect';
import { VocabularyList } from './VocabularyList';
import { ExerciseLibrary } from './ExerciseLibrary';
export function Library() {
 const [params,setParams]=useSearchParams(), type=params.get('type')||'vocabulary',collection=params.get('collection')||'all';
 const [collections,setCollections]=useState<Collection[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetchCollections().then(c=>{if(active){setCollections(c);setReady(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 const valid=collection==='all'||collection==='unassigned'||collections.some(c=>c.id===collection);
 function change(key:string,value:string){const next=new URLSearchParams(params);next.set(key,value);setParams(next);}
 return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-8"><header><h1 className="text-3xl font-bold">Library</h1><p className="mt-2 text-slate-600">Find, organize and manage your learning material.</p></header>
 <nav aria-label="Library content" className="flex flex-wrap gap-2">{['vocabulary','exercises','articles'].map(t=><Link key={t} aria-current={type===t?'page':undefined} className={`rounded-xl border px-4 py-3 font-semibold capitalize ${type===t?'bg-[#002434] text-white':'bg-white'}`} to={`?${new URLSearchParams({...Object.fromEntries(params),type:t})}`}>{t[0].toUpperCase()+t.slice(1)}</Link>)}</nav>
 <div className="flex flex-wrap items-end gap-4"><CollectionSelect collections={collections} value={collection} onChange={v=>change('collection',v)} disabled={type==='articles'}/><Link className="py-3 text-sm underline" to="/collections">Manage Collections</Link></div>
 {type==='articles'&&<p className="text-sm text-slate-600">Articles do not belong to Collections. Your Collection selection is retained for Vocabulary and Exercises.</p>}
 {error&&<p role="alert">{error}</p>}
 {!ready&&!error&&<p>Loading Library…</p>}
 {ready&&!valid&&type!=='articles'&&<p role="alert">This Collection is unavailable or was deleted. <button className="underline" onClick={()=>change('collection','all')}>Show All Collections</button></p>}
 {ready&&(valid||type==='articles')&&<>{type==='vocabulary'?<><div className="flex flex-wrap gap-4 text-sm"><Link className="underline" to={`/learn?method=vocabulary&collection=${collection}`}>Practice these words</Link><Link className="underline" to={`/learn?method=review&scope=vocabulary&collection=${collection}`}>Review due words</Link></div><VocabularyList key={collection} collection={collection}/></>:type==='exercises'?<ExerciseLibrary key={collection} collection={collection}/>:type==='articles'?<ArticleLibrary/>:<p role="alert">Choose Vocabulary, Exercises or Articles.</p>}</>}
 </div>;
}
