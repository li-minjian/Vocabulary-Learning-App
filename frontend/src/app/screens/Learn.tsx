import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BookOpen, ListChecks, RotateCcw, Brain } from 'lucide-react';
import { fetchCollections, type Collection } from '../../lib/api';
import { fetchArticles, type Article } from '../../lib/articles';
import { listExerciseSets, getExerciseSet, listExerciseSessions, startExerciseSession, type ExerciseSet, type StudySession } from '../../lib/exercises';
import { flowPath, learningConfigPath, lastFlow, learningSummary, saveFlow, vocabularyQueue, type LearningFlow, type LearningSummary, type Method, type ReviewMode } from '../../lib/learning';
import { normalizeArticle, restoreTypingState } from '../../lib/typingEngine';
import { useAuth } from '../contexts/AuthContext';
import { CollectionSelect } from '../components/CollectionSelect';
const methods = [
 {id:'typing',label:'Reading & Typing',text:'Read and type a saved article.',icon:BookOpen},
 {id:'exercises',label:'Exercises',text:'Practice new or existing questions.',icon:ListChecks},
 {id:'review',label:'Review',text:'Revisit scheduled words and exercises.',icon:RotateCcw},
 {id:'vocabulary',label:'Vocabulary Recall',text:'Practice words without changing their schedule.',icon:Brain},
] as const;
const input='min-h-11 w-full rounded-xl border bg-white px-3 py-2';
const primary='min-h-12 rounded-xl bg-[#002434] px-6 py-3 font-bold text-white disabled:opacity-50';
export function Learn() {
 const {user}=useAuth(), navigate=useNavigate();
 const [params,setParams]=useSearchParams();
 const method=params.get('method') as Method | null, collection=params.get('collection')||'all';
 const setId=params.get('set')||'',articleId=params.get('article')||'';
 const [collections,setCollections]=useState<Collection[]>([]),[sets,setSets]=useState<ExerciseSet[]>([]),[articles,setArticles]=useState<Article[]>([]),[sessions,setSessions]=useState<StudySession[]>([]);
 const [detail,setDetail]=useState<Awaited<ReturnType<typeof getExerciseSet>>|null>(null),[summary,setSummary]=useState<LearningSummary|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const [limit,setLimit]=useState(20),[mode,setMode]=useState('all'),[format,setFormat]=useState<ReviewMode>('flashcard'),[includeUnscheduled,setIncludeUnscheduled]=useState(true),[resumeExerciseId,setResumeExerciseId]=useState('');
 const [resume,setResume]=useState<LearningFlow|null>(null);
 const draft=useRef<{signature:string;id:string;exerciseId:string}|null>(null);
 const category=params.get('category')||'',unit=params.get('unit')||'',deck=params.get('deck')||'';
 const validMethod=methods.some(m=>m.id===method), validCollection=collection==='all'||collection==='unassigned'||collections.some(c=>c.id===collection);
 const scopedSets=sets.filter(s=>collection==='all'||(collection==='unassigned'?!s.collection_id:s.collection_id===collection));
 const selectedSet=sets.find(s=>s.id===setId);
 const invalidSet=!!setId&&(!selectedSet||!scopedSets.some(s=>s.id===setId));
 const invalidArticle=!!articleId&&!articles.some(a=>a.id===articleId);
 const invalidFilters=!!detail&&((!!category&&!detail.categories.includes(category))|| (!!unit&&!detail.units.includes(unit))|| (!!deck&&!detail.decks.includes(deck)));
 const requestedScope=params.get('scope');
 const defaultScope=summary?.vocabulary.due&&summary.exercises.due?'mixed':summary?.exercises.due?'exercises':'vocabulary';
 const scope=requestedScope||defaultScope;
 const invalidScope=method==='review'&&!['mixed','vocabulary','exercises'].includes(scope);
 function change(values:Record<string,string|null>) {
  const next=new URLSearchParams(params);for(const [key,value] of Object.entries(values)){if(value)next.set(key,value);else next.delete(key);}setParams(next);setError('');
 }
 useEffect(()=>{
  let active=true;setReady(false);setError('');
  Promise.all([fetchCollections(),listExerciseSets(),fetchArticles(),listExerciseSessions()]).then(([c,s,a,r])=>{if(!active)return;setCollections(c);setSets(s.items);setArticles(a);setSessions(r.items);setReady(true);}).catch(e=>{if(active)setError(e.message);});
  try {if(user)setResume(lastFlow(user.id));} catch { /* The Start action reports unavailable storage. */ }
  return()=>{active=false;};
 },[user?.id,refresh]);
 useEffect(()=>{
  if(!method&&user){let remembered: string|null=null;try{remembered=localStorage.getItem(`voca:learn:method:${user.id}`);}catch{/* Optional preference. */}if(methods.some(m=>m.id===remembered))setParams(p=>{const n=new URLSearchParams(p);n.set('method',remembered!);return n;},{replace:true});}
  else if(validMethod&&user){try{localStorage.setItem(`voca:learn:method:${user.id}`,method!);}catch{/* Optional preference. */}}
 },[method,user?.id,validMethod,setParams]);
 useEffect(()=>{
  setDetail(null);if(!setId||invalidSet||!ready)return;let active=true;
  getExerciseSet(setId).then(d=>{if(active)setDetail(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[setId,invalidSet,ready]);
 const queryKey=new URLSearchParams({collection,...((method==='exercises'||method==='review')?{set:setId,category,unit,deck}:{})}).toString();
 useEffect(()=>{
  setSummary(null);if(!ready||!validCollection||invalidSet)return;let active=true;
  learningSummary(Object.fromEntries(new URLSearchParams(queryKey))).then(s=>{if(active)setSummary(s);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[queryKey,ready,validCollection,invalidSet,refresh]);
 const selectedArticle=articles.find(a=>a.id===articleId);
 let typingProgress=0;
 try{if(selectedArticle&&user)typingProgress=restoreTypingState(normalizeArticle(selectedArticle.raw_text),localStorage.getItem(`voca:typing:v1:${user.id}:${selectedArticle.id}`))?.typed.length||0;}catch{/* No progress claimed. */}
 const active=sessions.filter(s=>s.status==='active'&&(!category||s.config.category===category)&&(!unit||s.config.unit===unit)&&(!deck||s.config.source_deck===deck)&&(method!=='review'||s.config.mode==='due')&& (!setId||s.config.set_id===setId)&&(collection==='all'||s.config.collection_id===collection||scopedSets.some(set=>set.id===s.config.set_id)));
 const context=new URLSearchParams({set:setId,category,unit,deck,scope:method==='review'?scope:''}).toString();
 const resumeMatches=resume&&resume.phase!=='complete'&&resume.collection===collection&&resume.context===context&&((method==='vocabulary'&&resume.practice)||(method==='review'&&!resume.practice&&((scope==='mixed'&&resume.mixed)||(scope==='vocabulary'&&!resume.mixed&&!resume.exerciseId))));
 const scheduled=summary ? (scope==='exercises'?0:summary.vocabulary.due)+(scope==='vocabulary'?0:summary.exercises.due):0;
 const eligible=scheduled+(summary&&scope!=='exercises'&&includeUnscheduled?summary.vocabulary.unscheduled:0);
 async function start() {
  if(!user||busy)return;setBusy(true);setError('');
  try{
   if(resumeExerciseId){navigate(`/exercises/session/${resumeExerciseId}`);return;}
   if(method==='typing'){navigate(`/practice/${articleId}`);return;}
   if(resumeMatches){navigate(flowPath(resume!));return;}
   const signature=JSON.stringify({method,collection,setId,category,unit,deck,limit,mode,format,scope,includeUnscheduled});
   if(draft.current?.signature!==signature)draft.current={signature,id:crypto.randomUUID(),exerciseId:crypto.randomUUID()};
   const {id,exerciseId}=draft.current;
   const exercises=method==='exercises'||(method==='review'&&scope!=='vocabulary');
   const vocabulary=method==='vocabulary'||(method==='review'&&scope!=='exercises');
   const wordLimit=method==='review'&&scope==='mixed'&&(summary?.exercises.due||0)>0?Math.ceil(limit/2):limit;
   const words=vocabulary?(await vocabularyQueue(wordLimit,collection,method==='vocabulary',includeUnscheduled)).items:[];
   if(vocabulary&&!exercises&&!words.length)throw new Error('No vocabulary matches this scope.');
   const flow:LearningFlow={version:1,id,user:user.id,collection,modes:[format],practice:method==='vocabulary',wordIds:words.map(w=>String(w.id)),mixed:method==='review'&&scope==='mixed',context,ready:false,phase:words.length?'vocabulary':'exercises',createdAt:new Date().toISOString()};
   // A checkpoint must be durable before starting a cross-domain sequence.
   if(vocabulary)saveFlow(flow);
   if(exercises){
    const exerciseLimit=flow.mixed?Math.max(0,limit-words.length):limit;
    if(exerciseLimit>0&&(method==='exercises'||(summary?.exercises.due||0)>0)){
     const r=await startExerciseSession({collection_id:collection,set_id:setId||null,mode:method==='review'?'due':mode,limit:exerciseLimit,category,unit,source_deck:deck},exerciseId);
     flow.exerciseId=r.session.id;
    }
   }
   if(!words.length&&!flow.exerciseId)throw new Error('No items match this queue.');
   if(!words.length&&flow.exerciseId&&!flow.mixed){navigate(`/exercises/session/${flow.exerciseId}`);return;}
   flow.ready=true;saveFlow(flow);setResume(flow);navigate(flowPath(flow));
  }catch(e){setError(e instanceof Error?e.message:'Unable to start. Retry to confirm the same session.');}finally{setBusy(false);}
 }
 useEffect(()=>setResumeExerciseId(''),[method,collection,setId,category,unit,deck]);
 const disabled=!ready||!validMethod||!validCollection||invalidSet||invalidArticle||invalidFilters||invalidScope||busy||limit<1||limit>200||!Number.isInteger(limit)||(!!setId&&!detail)||(!resumeMatches&&!resumeExerciseId&&((method==='typing'&&!selectedArticle)||(method==='exercises'&&!scopedSets.length)||(method==='vocabulary'&&!summary?.vocabulary.total)||(method==='review'&&(!summary||!eligible))));
 return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
 <header><h1 className="text-3xl font-bold">Learn</h1><p className="mt-2 text-slate-600">Choose how you want to learn today.</p></header>
 <div role="group" aria-label="Learning method" className="grid gap-3 sm:grid-cols-2">{methods.map(m=><button key={m.id} aria-pressed={method===m.id} className={`rounded-2xl border p-5 text-left ${method===m.id?'border-teal-600 bg-teal-50':'bg-white hover:border-slate-400'}`} onClick={()=>change({method:m.id,set:null,category:null,unit:null,deck:null,scope:null})}><m.icon className="mb-3 h-5 w-5"/><span className="block font-bold">{m.label}</span><span className="mt-1 block text-sm text-slate-600">{m.text}</span></button>)}</div>
 {!ready&&!error&&<p role="status">Loading your learning material…</p>}
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error} <button className="underline" onClick={()=>setRefresh(n=>n+1)}>Reload</button></p>}
 {ready&&(!validCollection||invalidSet||invalidArticle||invalidFilters||invalidScope||(!!method&&!validMethod))&&<p role="alert" className="rounded-xl bg-amber-50 p-4">This link contains unavailable material or settings. Choose a valid scope before starting. <button className="underline" onClick={()=>change({collection:'all',set:null,article:null,category:null,unit:null,deck:null,scope:null,...(!validMethod?{method:null}:{})})}>Clear unavailable context</button></p>}
 {validMethod&&ready&&<section className="space-y-5 rounded-2xl border bg-white p-5" aria-label="Learning settings">
 <h2 className="text-xl font-bold">{methods.find(m=>m.id===method)?.label}</h2>
 {method==='typing'?<><label className="block space-y-1 text-sm font-semibold">Saved Article<select aria-label="Saved Article" className={input} value={articleId} onChange={e=>change({article:e.target.value})}><option value="">Choose an article</option>{articles.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>{selectedArticle&&<p className="text-sm text-slate-600">{selectedArticle.language} · {Array.from(selectedArticle.raw_text).length.toLocaleString()} characters · {typingProgress?`${typingProgress} characters typed in this browser`:'No saved progress in this browser'}</p>}<p className="text-sm">Typing progress is saved in this browser, under your account.</p>{!articles.length&&<p>No Articles yet. <Link className="underline" to="/practice">Import or save an article</Link> to begin Reading &amp; Typing.</p>}</>:<>
 <CollectionSelect collections={collections} value={collection} onChange={value=>change({collection:value,set:null,category:null,unit:null,deck:null})}/>
 {(method==='exercises'||(method==='review'&&scope!=='vocabulary'))&&<><label className="block text-sm font-semibold">Exercise Set<select aria-label="Exercise Set" className={input} value={setId} onChange={e=>change({set:e.target.value,category:null,unit:null,deck:null})}><option value="">All Exercise Sets</option>{scopedSets.map(s=><option key={s.id} value={s.id}>{s.title} · {s.count} exercises</option>)}</select></label>{detail&&<div className="grid gap-3 sm:grid-cols-3">{([['Category','category',category,detail.categories],['Unit','unit',unit,detail.units],['Source deck','deck',deck,detail.decks]] as const).map(([label,key,value,options])=><label key={key} className="min-w-0 text-sm font-semibold">{label}<select aria-label={label} className={input} value={value} onChange={e=>change({[key]:e.target.value})}><option value="">All</option>{options.map(v=><option key={v}>{v}</option>)}</select></label>)}</div>}</>}
 {method==='exercises'&&<><label className="block text-sm font-semibold">Learning scope<select aria-label="Learning scope" className={input} value={mode} onChange={e=>setMode(e.target.value)}><option value="all">All Exercises</option><option value="new">New Exercises</option></select></label><p className="text-sm text-slate-600">{summary?.exercises.new??'…'} new · {summary?.exercises.total??'…'} exercises available. Practice records answers and updates the existing exercise schedule. New means never meaningfully studied.</p>{!scopedSets.length&&<p>No Exercises here. <Link className="underline" to="/import/files">Import an exercise set</Link> to start practicing.</p>}</>}
 {method==='review'&&<><div role="status" className="rounded-xl bg-slate-50 p-4">Vocabulary due: {summary?.vocabulary.due??'…'} · Exercises due: {summary?.exercises.due??'…'} · Total due: {summary?summary.vocabulary.due+summary.exercises.due:'…'}</div><label className="block text-sm font-semibold">Review scope<select aria-label="Review scope" className={input} value={scope} onChange={e=>change({scope:e.target.value})}><option value="mixed">Mixed Review</option><option value="vocabulary">Vocabulary Only</option><option value="exercises">Exercises Only</option></select></label>{scope!=='exercises'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={includeUnscheduled} onChange={e=>setIncludeUnscheduled(e.target.checked)}/><span>Include unscheduled vocabulary ({summary?.vocabulary.unscheduled??'…'}, includes new words). This preserves access to older words without a review timestamp.</span></label>}<p className="text-sm text-slate-600">{scope==='mixed'?'Vocabulary first, then exercises, up to the chosen total session size. Each domain saves its own progress.':'Only the selected domain is included.'} New items are counted separately from scheduled due reviews.</p>{summary&&!eligible&&<p>You’re all caught up in this scope. You can still practice new or existing material.</p>}</>}
 {(method==='vocabulary'||(method==='review'&&scope!=='exercises'))&&<label className="block text-sm font-semibold">Vocabulary format<select aria-label="Vocabulary format" className={input} value={format} onChange={e=>setFormat(e.target.value as ReviewMode)}><option value="flashcard">Flashcard</option><option value="multipleChoice">Multiple Choice</option><option value="spelling">Spelling</option></select></label>}
 {method==='vocabulary'&&<p className="text-sm text-slate-600">{summary?.vocabulary.total??'…'} words · {summary?.vocabulary.new??'…'} never studied. Recall records practice activity only; mastery, review count and next review stay unchanged. {!summary?.vocabulary.total&&<Link className="underline" to="/import">Import vocabulary to start studying words.</Link>}</p>}
 <label className="block text-sm font-semibold">Session size<input aria-label="Session size" className={`${input} max-w-32`} type="number" min="1" max="200" value={limit} onChange={e=>setLimit(Number(e.target.value))}/><span className="ml-2 font-normal text-slate-500">1–200 items</span></label>
 </>}
 {(method==='exercises'||(method==='review'&&scope==='exercises'))&&!!active.length&&<label className="block text-sm font-semibold">Continue Learning<select aria-label="Continue Learning" className={input} onChange={e=>setResumeExerciseId(e.target.value)} value={resumeExerciseId}><option value="">Choose a saved server session to resume</option>{active.map(s=><option key={s.id} value={s.id}>{s.position}/{s.exercise_ids.length} completed · {new Date(s.updated_at).toLocaleString()}</option>)}</select></label>}
 {resumeMatches&&<p className="text-sm">An unfinished session is available in this browser. Resuming uses its saved settings. <button className="underline" onClick={()=>setResume(null)}>Configure a new session instead</button></p>}
 <button className={primary} disabled={disabled} onClick={()=>void start()}>{busy?'Starting…':resumeExerciseId?'Resume exercise session':resumeMatches?'Resume session':method==='typing'?(typingProgress?'Continue Typing':'Start Typing'):method==='review'?'Start Review':method==='exercises'?'Start Practicing':'Start Vocabulary Recall'}</button>
 </section>}
 {resume&&resume.phase!=='complete'&&!resumeMatches&&<p className="text-sm">Continue Learning: <Link className="underline" to={learningConfigPath(resume)}>Open settings for your saved {resume.mixed?'Mixed Review':resume.practice?'Vocabulary Recall':'Vocabulary Review'}</Link>. This checkpoint is saved in this browser.</p>}
 <p className="text-sm text-slate-600">Add material in <Link className="underline" to="/import">Import</Link>; find and organize it in <Link className="underline" to="/library">Library</Link>.</p>
 </div>;
}
