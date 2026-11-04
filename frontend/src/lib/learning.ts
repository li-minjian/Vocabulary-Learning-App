import { fetchApi } from './api';
import type { VocabularyWord } from './types';
export type Method = 'typing' | 'exercises' | 'review' | 'vocabulary';
export type ReviewMode = 'flashcard' | 'multipleChoice' | 'spelling';
export type Counts = { total: number; new: number; due: number; attempts: number; correct: number; incorrect: number; self_assessed: number };
export interface LearningSummary {
 vocabulary: Counts & { unscheduled: number; mastered: number; learning: number; reviews: number; added_today: number; added_this_week: number };
 exercises: Counts & { practiced: number };
 languages: {name: string; count: number}[];
 activity: {day: string; date: string; vocabulary: number; exercises: number}[];
 timezone: string; as_of: string;
}
export const learningSummary = (params: Record<string, string> = {}) => fetchApi<LearningSummary>('/api/stats/learning?' + new URLSearchParams({timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...params}));
export interface VocabularyReceipt { id: string; word_id: string; correct: boolean | null; revealed: boolean; rating: string; mode: 'review' | 'practice'; }
export const vocabularyReceipts = (id: string) => fetchApi<{items: VocabularyReceipt[]}>(`/api/review/sessions/${id}/attempts`);
export const resolveVocabulary = (ids: string[]) => ids.length ? fetchApi<{items: VocabularyWord[]}>('/api/review/queue/resolve',{method:'POST',body:JSON.stringify({ids})}) : Promise.resolve({items:[] as VocabularyWord[]});
export const vocabularyQueue = (limit: number, collection: string, practice: boolean, includeUnscheduled: boolean) => fetchApi<{items: VocabularyWord[]}>(`/api/review/queue?${new URLSearchParams({limit: String(limit), collection_id: collection, mode: practice ? 'practice' : 'review', include_unscheduled: String(includeUnscheduled)})}`);
export const recordVocabulary = (body: Record<string, unknown>) => fetchApi<VocabularyReceipt>('/api/review/answer', {method: 'POST', body: JSON.stringify(body)});
export interface LearningFlow {
 version: 1; id: string; user: string; collection: string; modes: ReviewMode[];
 practice: boolean; wordIds: string[]; exerciseId?: string; mixed: boolean; context?: string; ready?: boolean;
 phase: 'vocabulary' | 'exercises' | 'complete'; createdAt: string;
}
const key = (user: string, id: string) => `voca:learning:v1:${user}:${id}`;
export function readFlow(user: string, id: string): LearningFlow | null {
 try { const f = JSON.parse(localStorage.getItem(key(user,id)) || 'null');
 return f?.version === 1 && f.user === user && f.id === id && f.ready !== false && Array.isArray(f.wordIds) && Array.isArray(f.modes) && ['vocabulary','exercises','complete'].includes(f.phase) ? f : null;
 } catch { return null; }
}
export function saveFlow(flow: LearningFlow) {
 localStorage.setItem(key(flow.user,flow.id), JSON.stringify(flow));
 localStorage.setItem(`voca:learning:last:${flow.user}`, flow.id);
}
export function lastFlow(user: string) {
 const id = localStorage.getItem(`voca:learning:last:${user}`);
 return id ? readFlow(user,id) : null;
}
export function flowPath(flow: LearningFlow) {
 if (flow.phase === 'complete') return `/review/result?flow=${flow.id}`;
 if (flow.phase === 'exercises') return `/exercises/session/${flow.exerciseId}?flow=${flow.id}`;
 return `/review/session?flow=${flow.id}`;
}
export function summarizeReceipts(items: VocabularyReceipt[]) {
 const correct=items.filter(a=>a.correct===true).length, incorrect=items.filter(a=>a.correct===false).length;
 return {attempted:items.length,correct,incorrect,self_assessed:items.filter(a=>a.correct===null).length,needs_review:items.filter(a=>['again','hard'].includes(a.rating)).length,accuracy:correct+incorrect ? Math.round(100*correct/(correct+incorrect)) : null};
}
export function learningConfigPath(flow: LearningFlow) {
 const context=Object.fromEntries(new URLSearchParams(flow.context||''));
 return '/learn?'+new URLSearchParams({...context,method:flow.practice?'vocabulary':'review',collection:flow.collection,...(!flow.practice?{scope:flow.mixed?'mixed':'vocabulary'}:{})});
}
