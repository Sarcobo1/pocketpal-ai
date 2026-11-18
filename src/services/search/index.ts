import type {SearchProvider, SearchProviderId, PageContent} from './types';
import {fetchText} from './providers/http';
import {TavilyProvider} from './providers/tavily';
import {BraveProvider} from './providers/brave';
import {ExaProvider} from './providers/exa';
import {FirecrawlProvider} from './providers/firecrawl';
import {ParallelProvider} from './providers/parallel';
import {YouProvider} from './providers/you';

export type {
  SearchProvider,
  SearchProviderId,
  SearchHit,
  PageContent,
  SearchBudget,
  SearchOptions,
} from './types';
export {
  budgetHits,
  budgetPage,
  getCachedHits,
  setCachedHits,
  resetSearchCache,
} from './searchBudget';

/** Wires each adapter to a key accessor so it reads its BYOK key lazily, without importing the store. */
export const createSearchProvider = (
  id: SearchProviderId,
  getKey: () => string,
): SearchProvider => {
  switch (id) {
    case 'tavily':
      return new TavilyProvider(getKey);
    case 'brave':
      return new BraveProvider(getKey);
    case 'exa':
      return new ExaProvider(getKey);
    case 'firecrawl':
      return new FirecrawlProvider(getKey);
    case 'parallel':
      return new ParallelProvider(getKey);
    case 'you':
      return new YouProvider(getKey);
  }
};

/** Fallback reader for providers without native read(): tries r.jina.ai first, falls back to direct HTML fetch. */
export const readWithDefaultReader = async (
  url: string,
  signal?: AbortSignal,
): Promise<PageContent> => {
  try {
    const text = await fetchText(`https://r.jina.ai/${encodeURI(url)}`, {
      method: 'GET',
      signal,
    });
    if (text && text.trim().length > 0) {
      return {url, text};
    }
  } catch {
    // Fall back to direct fetch if proxy fails or times out
  }

  try {
    const rawHtml = await fetchText(url, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });
    const plainText = rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {url, text: plainText};
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read page: ${errMsg}`);
  }
};
