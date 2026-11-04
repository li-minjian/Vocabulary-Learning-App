import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchArticles, type Article } from '../../lib/articles';
/** The acquisition screen and Library share this list and existing article service. */
export function SavedArticles({articles}:{articles:Article[]}){
 const [search,setSearch]=useState('');
 const visible=articles.filter(a=>`${a.title} ${a.language}`.toLowerCase().includes(search.toLowerCase()));
 return <div className="space-y-4"><label className="block text-sm">Find articles<input className="mt-1 min-h-11 w-full rounded-xl border px-3" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search title or language"/></label>{visible.map(a=><article key={a.id} className="space-y-2 rounded-2xl border bg-white p-5"><h2 className="break-words text-xl font-bold">{a.title}</h2><p className="text-sm text-slate-600">{a.language} · {Array.from(a.raw_text).length.toLocaleString()} characters{a.created_at?` · ${new Date(a.created_at).toLocaleDateString()}`:''}</p><Link className="inline-block rounded-xl border px-4 py-3 font-semibold" to={`/learn?method=typing&article=${a.id}`}>Type this article</Link></article>)}{!articles.length&&<p>Import or save an article to begin Reading &amp; Typing.</p>}{!!articles.length&&!visible.length&&<p>No articles match your search.</p>}</div>;
}
export function ArticleLibrary(){
 const [articles,setArticles]=useState<Article[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetchArticles().then(a=>{if(active)setArticles(a);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return <section className="space-y-4" aria-label="Saved Articles"><Link className="inline-block rounded-xl border bg-white px-4 py-3 font-semibold" to="/practice">Upload or paste an article</Link>{error&&<p role="alert">{error}</p>}{!articles&&!error&&<p>Loading Articles…</p>}{articles&&<SavedArticles articles={articles}/>}</section>;
}
