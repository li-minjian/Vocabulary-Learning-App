import { fetchApi } from './api';

export interface ParsedList {
  import_id: string;
  columns: string[];
  rows: string[][];
  row_numbers: number[];
  warnings: string[];
  invalid_rows: { row: number; message: string }[];
  has_header: boolean;
  count: number;
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
}
export interface ImportPayload {
  import_id: string;
  rows: ImportRow[];
  language: string;
  collection_id: string | null;
  conflict: 'skip' | 'keep_both';
}
export interface RowResult {
  row: number;
  word?: string;
  id?: string;
  status: 'ready' | 'invalid' | 'skipped' | 'imported' | 'resumed' | 'failed';
  message?: string;
  duplicate?: boolean;
  word_saved?: boolean;
}
export interface ImportPreview { ready: number; skipped: number; invalid: number; duplicates: number; rows: RowResult[] }
export interface ImportResult { import_id: string; imported: number; resumed: number; skipped: number; invalid: number; failed: number; rows: RowResult[] }

export async function parseList(file: File | null, text: string, delimiter: string, header: string): Promise<ParsedList> {
  if (file) {
    const body = new FormData();
    body.append('file', file);
    if (delimiter) body.append('delimiter', delimiter);
    body.append('has_header', header);
    return fetchApi<ParsedList>('/api/file-import/parse', { method: 'POST', body });
  }
  return fetchApi<ParsedList>('/api/file-import/parse', {
    method: 'POST', body: JSON.stringify({ text, filename: 'pasted-list.txt', delimiter: delimiter || undefined,
      has_header: header === 'auto' ? undefined : header === 'true' }),
  });
}
export const previewList = (payload: ImportPayload) => fetchApi<ImportPreview>('/api/file-import/preview', { method: 'POST', body: JSON.stringify(payload) });
export const commitList = (payload: ImportPayload) => fetchApi<ImportResult>('/api/file-import/commit', { method: 'POST', body: JSON.stringify(payload) });
