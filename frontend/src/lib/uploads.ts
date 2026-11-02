import policy from '../../../backend/upload_policy.json';
import { ApiError, buildApiUrl, fetchApi, getFreshToken } from './api';

export const MAX_UPLOAD_BYTES = policy.max_file_bytes;
export interface UploadProgress { stage: 'authorizing' | 'uploading' | 'processing'; percent: number }
export interface DocumentExtraction { text: string; needs_ocr: boolean; ai_allowed?: boolean; pages?: number; method: string; warnings?: string[] }
interface Ticket { upload_id: string; transport: 'gcs-post' | 'local-put'; url: string; fields: Record<string, string>; content_type: string; expires_at: number; uploaded?: boolean }
const tickets = new WeakMap<File, { recipe: string; ticket: Ticket }>();

export function validateFile(file: File, workflow: 'file' | 'article') {
  if (!file.size) throw new Error('Choose a non-empty file.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds 50 MiB (52,428,800 bytes).');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const allowed = workflow === 'file' ? policy.file_extensions : policy.article_extensions;
  if (!allowed.includes(extension)) throw new Error(`Unsupported format. Choose ${allowed.join(', ')}.`);
}

export async function cancelUpload(file: File) {
  const existing = tickets.get(file);
  tickets.delete(file);
  if (existing) await fetchApi(`/api/uploads/${existing.ticket.upload_id}`, { method: 'DELETE' });
}

export async function processUpload<T>(file: File, workflow: 'file' | 'article', options: {
  method?: 'local' | 'ai'; delimiter?: string; has_header?: boolean; signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
} = {}): Promise<T> {
  validateFile(file, workflow);
  const recipe = JSON.stringify([workflow, options.delimiter, options.has_header]);
  const prior = tickets.get(file);
  let ticket = prior?.recipe === recipe ? prior.ticket : undefined;
  if (!ticket || (!ticket.uploaded && Date.now() / 1000 > ticket.expires_at)) {
    options.onProgress?.({ stage: 'authorizing', percent: 0 });
    ticket = await fetchApi<Ticket>('/api/uploads', { method: 'POST', signal: options.signal,
      body: JSON.stringify({ filename: file.name, size: file.size, workflow }) });
    tickets.set(file, { recipe, ticket });
  }
  if (options.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  if (!ticket.uploaded) {
    const token = ticket.transport === 'local-put' ? await getFreshToken() : null;
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => { xhr.abort(); reject(new DOMException('Upload cancelled', 'AbortError')); };
        const clean = () => options.signal?.removeEventListener('abort', abort);
        xhr.open(ticket!.transport === 'gcs-post' ? 'POST' : 'PUT', ticket!.transport === 'gcs-post' ? ticket!.url : buildApiUrl(ticket!.url));
        // Supabase credentials are sent only to the local application, never GCS.
        if (ticket!.transport === 'local-put') {
          xhr.setRequestHeader('Content-Type', ticket!.content_type);
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.upload.onprogress = event => options.onProgress?.({ stage: 'uploading', percent: event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0 });
        xhr.onload = () => { clean(); xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed or its authorization expired. Retry the file.')); };
        xhr.onerror = () => { clean(); reject(new Error('Upload interrupted. Check your connection and retry.')); };
        xhr.onabort = () => { clean(); reject(new DOMException('Upload cancelled', 'AbortError')); };
        options.signal?.addEventListener('abort', abort, { once: true });
        options.onProgress?.({ stage: 'uploading', percent: 0 });
        if (ticket!.transport === 'gcs-post') {
          const body = new FormData();
          Object.entries(ticket!.fields).forEach(([key, value]) => body.append(key, value));
          body.append('file', file);
          xhr.send(body);
        } else xhr.send(file);
      });
      ticket.uploaded = true;
    } catch (error) {
      tickets.delete(file);
      void fetchApi(`/api/uploads/${ticket.upload_id}`, { method: 'DELETE' }).catch(() => {});
      throw error;
    }
  }
  options.onProgress?.({ stage: 'processing', percent: 100 });
  try {
    return await fetchApi<T>(`/api/uploads/${ticket.upload_id}/process`, { method: 'POST', signal: options.signal,
      body: JSON.stringify({ workflow, method: options.method || 'local', consent_ai: options.method === 'ai',
        delimiter: options.delimiter, has_header: options.has_header }) });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) tickets.delete(file);
    throw error;
  }
}
