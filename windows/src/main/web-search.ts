import type { WebSearchEngine } from '../shared';

export function webSearchUrl(engine: WebSearchEngine, query: string): string {
  if (engine !== 'google' && engine !== 'duckduckgo') throw new Error('未知搜索引擎');
  if (typeof query !== 'string' || query.length > 200) throw new Error('搜索内容过长');
  const url = new URL(engine === 'google' ? 'https://www.google.com/search' : 'https://duckduckgo.com/');
  const term = query.trim();
  if (term) url.searchParams.set('q', term);
  else if (engine === 'google') url.pathname = '/';
  return url.href;
}
