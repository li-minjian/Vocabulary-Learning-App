import { fetchApi } from './api';
export interface ExerciseDocument {
  mode: 'cloze' | 'choice' | 'self_assess';
  kind: string;
  question: string;
  original_question: string;
  answer_source:string;
  completed: string;
  segments: ({
    text: string;
  } | {
    blank: number;
  })[];
  blanks: {
    index: number;
    cloze_index: number;
    expected: string[];
    hint: string;
  }[];
  expected: string[][];
  instruction: string;
  choices: string;
  options?: string[];
  explanation: string;
  category: string;
  unit: string;
  source_deck: string;
  tags: string;
  transcript: string;
  warnings: string[];
  unsupported: string[];
  source_key: string;
  source: Record<string, unknown>;
}
export interface ExerciseSet {
  content_types?:string[];
  id: string;
  title: string;
  collection_id: string | null;
  source_filename: string;
  source_digest: string;
  created_at: string;
  count: number;
  completed: number;
  due: number;
  last_practiced: string | null;
}
export interface ExerciseItem {
  id: string;
  set_id: string;
  category: string;
  unit: string;
  source_deck: string;
  document: ExerciseDocument;
  hints?: string[];
  total_attempts: number;
  correct_attempts: number;
  next_review: string | null;
  learning_state: string;
}
export interface PreparedExercise {
  id: string;
  position: number;
  status: 'ready' | 'unsupported' | 'unchanged' | 'conflict';
  document: ExerciseDocument;
  content_hash: string;
  existing_set_id: string | null;
}
export interface ExercisePreview {
  items: PreparedExercise[];
  counts: Record<string, number>;
  notes: number;
  cards: number;
}
export interface Attempt {
  id: string;
  session_id: string;
  exercise_id: string;
  answers: string[];
  revealed: boolean;
  correct: boolean | null;
  rating: string | null;
  created_at: string;
  result: {
    correct: boolean | null;
    expected: string[][];
    completed: string;
    explanation: string;
    warnings: string[];
    needs_self_assessment: boolean;
  };
}
export interface StudySession {
  id: string;
  exercise_ids: string[];
  position: number;
  status: 'active' | 'finished' | 'ended';
  config: Record<string, unknown>;
  updated_at: string;
}
export interface SessionDetail {
  session: StudySession;
  current: ExerciseItem | null;
  attempt: Attempt | null;
  summary: {
    attempted: number;
    correct: number;
    incorrect: number;
    skipped: number;
    self_assessed: number;
    needs_review: number;
    accuracy: number | null;
  };
}
const send = <T,>(path: string, body: unknown, method = 'POST') => fetchApi<T>('/api/exercises' + path, {
  method,
  body: JSON.stringify(body)
});
export const listExerciseSets = () => fetchApi<{
  items: ExerciseSet[];
}>('/api/exercises/sets');
export const createExerciseSet = (body: unknown) => send<ExerciseSet>('/sets', body);
export const getExerciseSet = (id: string, offset = 0, filters: Record<string, string> = {}) => fetchApi<{
  set: ExerciseSet;
  count: number;
  categories: string[];
  units: string[];
  decks: string[];
  items: ExerciseItem[];
}>(`/api/exercises/sets/${id}?offset=${offset}&limit=50&${new URLSearchParams(filters)}`);
export const renameExerciseSet = (id: string, title: string) => send<ExerciseSet>(`/sets/${id}`, {
  title
}, 'PATCH');
export const deleteExerciseSet = (id: string, confirmation: string) => send(`/sets/${id}`, {
  confirmation
}, 'DELETE');
export const getExercise = (id: string) => fetchApi<{
  exercise: ExerciseItem;
  history: Attempt[];
}>(`/api/exercises/items/${id}`);
export const deleteExercise = (id: string) => send<{
  deleted: boolean;
}>(`/items/${id}`, {
  confirmation: 'DELETE EXERCISE'
}, 'DELETE');
export const previewExercises = (notes: unknown[]) => send<ExercisePreview>('/import/preview', {
  notes
});
export const commitExercises = (set_id: string, items: PreparedExercise[], source_digest: string,allow_text_only_media=false) => send<{
  items: {
    id?: string;
    status: string;
    set_id?: string;
  }[];
  counts: Record<string, number>;
}>('/import/commit', {
  set_id,
  items,
  source_digest,allow_text_only_media
});
export const startExerciseSession = (config: Record<string, unknown>, id = crypto.randomUUID()) => send<SessionDetail>('/sessions', {
  ...config,
  id
});
export const listExerciseSessions = () => fetchApi<{
  items: StudySession[];
}>('/api/exercises/sessions');
export const getExerciseSession = (id: string) => fetchApi<SessionDetail>(`/api/exercises/sessions/${id}`);
export const answerExercise = (id: string, body: unknown) => send<Attempt>(`/sessions/${id}/answer`, body);
export const rateExercise = (id: string, exercise_id: string, rating: string) => send<SessionDetail>(`/sessions/${id}/rate`, {
  exercise_id,
  rating
});
export const endExerciseSession = (id: string) => send<SessionDetail>(`/sessions/${id}/end`, {});
