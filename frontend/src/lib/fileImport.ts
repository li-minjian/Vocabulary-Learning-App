import { fetchApi } from './api';
import { processUpload, type UploadProgress } from './uploads';

export interface SourceField { name: string; column: number; derived?: string; from_column?: number; canonical_column?: number }
export interface FieldSuggestion extends SourceField {
  role: string; confidence: number; reason: string;
  evidence: { sampled_nonempty: number; sample_size: number; mean_words: number; scripts: string[]; front_reference: boolean; back_reference: boolean };
}
export interface ImportGroup {
  id: string; name: string; count: number; row_numbers: number[]; fields: SourceField[]; native_cards: number;
  model_type?: number;
  warnings?: string[];
  templates: { name: string; front: {field:string;filters:string[]}[]; back: {field:string;filters:string[]}[]; scripted: boolean; media: boolean }[];
  analysis: { kind: string; confidence: number; reason: string; fields: FieldSuggestion[]; mapping: Record<string,string>; source_mapping: Record<string,number>; sample_rows: number[]; unresolved: string[] };
}
export interface NoteProvenance { note_id?: string; group_id?: string; card_count?: number; deck_names?: string[]; cloze_indices?: number[]; has_media?: boolean; cards?: {id:string;ordinal:number|null;deck:string}[] }
export interface ParsedList {
  import_id: string;
  columns: string[];
  rows: string[][];
  row_numbers: number[];
  warnings: string[];
  invalid_rows: { row: number; message: string }[];
  has_header: boolean;
  count: number;
  groups: ImportGroup[];
  provenance: NoteProvenance[];
}
export interface ImportRow {
  row: number;
  word: string;
  language?: string;
  collocations?: string;
  translation?: string;
  definition?: string;
  examples?: string;
  tags?: string;
  source?: string;
  pos?: string;
  ipa?: string;
  source_kind?: string;
  conversion_confirmed?: boolean;
  source_note_id?: string;
  source_group_id?: string;
}
export interface ImportPayload {
  import_id: string;
  rows: ImportRow[];
  language: string;
  collection_id: string | null;
  conflict: 'skip' | 'keep_both';
  allow_numeric?: boolean;
}
export interface RowResult {
  row: number;
  word?: string;
  id?: string;
  status: 'ready' | 'invalid' | 'skipped' | 'imported' | 'resumed' | 'failed';
  message?: string;
  duplicate?: boolean;
  word_saved?: boolean;
  translation?: string;
  definition?: string;
  examples?: { sentence: string }[];
  language?: string;
  source_note_id?: string;
  source_group_id?: string;
  source_kind?: string;
}
export interface ImportPreview { ready: number; skipped: number; invalid: number; duplicates: number; rows: RowResult[] }
export interface ImportResult { import_id: string; imported: number; resumed: number; skipped: number; invalid: number; failed: number; rows: RowResult[] }

export async function parseList(file: File | null, text: string, delimiter: string, header: string, options?: { signal?: AbortSignal; onProgress?: (value: UploadProgress) => void }): Promise<ParsedList> {
  if (file) {
    return processUpload<ParsedList>(file, 'file', { ...options, delimiter: delimiter || undefined,
      has_header: header === 'auto' ? undefined : header === 'true' });
  }
  return fetchApi<ParsedList>('/api/file-import/parse', {
    method: 'POST', body: JSON.stringify({ text, filename: 'pasted-list.txt', delimiter: delimiter || undefined,
      has_header: header === 'auto' ? undefined : header === 'true' }),
  });
}
export const previewList = (payload: ImportPayload) => fetchApi<ImportPreview>('/api/file-import/preview', { method: 'POST', body: JSON.stringify(payload) });
export const commitList = (payload: ImportPayload) => fetchApi<ImportResult>('/api/file-import/commit', { method: 'POST', body: JSON.stringify(payload) });
