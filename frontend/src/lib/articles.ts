import { fetchApi } from './api';

export interface Article {
  id: string;
  title: string;
  raw_text: string;
  language: string;
  source_type?: string;
  created_at?: string;
}

export async function fetchArticles(): Promise<Article[]> {
  const result = await fetchApi<{ items: Article[] }>('/api/articles');
  return result.items;
}

export function fetchArticle(id: string): Promise<Article> {
  return fetchApi<Article>(`/api/articles/${encodeURIComponent(id)}`);
}

export function saveArticle(article: Pick<Article, 'title' | 'raw_text' | 'language'> & { source_type?: string }): Promise<Article> {
  return fetchApi<Article>('/api/articles', { method: 'POST', body: JSON.stringify(article) });
}
