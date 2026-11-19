import {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
  SystemPromptContext,
} from './types';
import type {SearchAccess} from './searchAccess';
import {SEARCH_NOT_SET_UP_MESSAGE} from './searchAccess';
import type {SearchHit} from '../search/types';
import {
  budgetHits,
  cacheKey,
  getCachedHits,
  setCachedHits,
} from '../search/searchBudget';
import {wrapUntrusted} from './untrustedContent';
import {allowReadUrls} from './readUrlAllowlist';

const PER_SNIPPET_CHARS = 280;

const inFlight = new Map<string, Promise<SearchHit[]>>();

const formatHit = (hit: SearchHit): string => {
  const date = hit.publishedAt ? ` *(${hit.publishedAt})*` : '';
  const lines = [`- **${hit.title || hit.url}**${date}`];
  if (hit.snippet) {
    lines.push(`  ${hit.snippet}`);
  }
  lines.push(`  <${hit.url}>`);
  return lines.join('\n');
};

const formatMenu = (query: string, hits: SearchHit[]): string => {
  const retrievedAt = new Date().toISOString().slice(0, 10);
  return [
    `## Web search results for "${query}" (retrieved ${retrievedAt})`,
    ...hits.map(formatHit),
  ].join('\n');
};

/**
 * `web_search` talent. Result count comes from settings, not a tool parameter,
 * so the model can't inflate it.
 */
export class WebSearchEngine implements TalentEngine {
  readonly name = 'web_search';
  readonly recommendedContextTokens = 1000;

  constructor(private access: SearchAccess) {}

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return {
        type: 'error',
        summary: 'web_search: missing or empty "query" argument',
        errorMessage:
          'query argument is required and must be a non-empty string',
      };
    }

    if (!this.access.canSearch()) {
      return {
        type: 'error',
        summary: `web_search: ${SEARCH_NOT_SET_UP_MESSAGE}`,
        errorMessage: SEARCH_NOT_SET_UP_MESSAGE,
      };
    }

    const provider = this.access.getActiveProvider();
    const maxResults = this.access.getResultCount();

    let hits: SearchHit[];
    try {
      const cached = getCachedHits(provider.id, query, maxResults);
      const key = cacheKey(provider.id, query, maxResults);
      const shared = inFlight.get(key);
      if (cached) {
        hits = cached;
      } else if (shared) {
        hits = await shared;
      } else {
        const request = provider.search(query, {maxResults}, ctx?.signal);
        inFlight.set(key, request);
        try {
          hits = await request;
        } finally {
          inFlight.delete(key);
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `web_search: ${errMsg}`,
        errorMessage: errMsg,
      };
    }

    const budgeted = budgetHits(
      hits,
      {
        maxResults,
        perSnippetChars: PER_SNIPPET_CHARS,
        tokenCeiling: this.recommendedContextTokens,
      },
      formatHit,
    );

    if (budgeted.length === 0) {
      if (__DEV__) {
        console.log('[web_search]', {query, provider: provider.id, count: 0});
      }
      // No usable hits — provider returned none, or budgeting rejected them all.
      // Don't cache: a transient/all-rejected empty must not lock out retries or
      // flip the same input between success and error on replay.
      const summary = `web_search: no results for "${query}". Try a shorter or less restrictive query.`;
      return {type: 'error', summary, errorMessage: summary};
    }

    // Cache the budgeted hits, not the raw payload — same model-visible result
    // on replay, without retaining oversized provider snippets.
    setCachedHits(provider.id, query, maxResults, budgeted);
    allowReadUrls(budgeted.map(h => h.url));

    if (__DEV__) {
      console.log('[web_search]', {
        query,
        provider: provider.id,
        count: budgeted.length,
        results: budgeted.map(h => ({title: h.title, url: h.url})),
      });
    }

    return {
      type: 'search',
      query,
      results: budgeted.map(h => ({
        title: h.title,
        url: h.url,
        snippet: h.snippet,
      })),
      summary: wrapUntrusted(formatMenu(query, budgeted)),
    };
  }

  systemPromptFragment(ctx: SystemPromptContext): string {
    const today = ctx.now.toISOString().slice(0, 10);
    const budget = ctx.maxToolTurns - 1;
    const readUrl = ctx.activeTalents.has('read_url')
      ? ' then read the top result with read_url'
      : '';
    return (
      `Today is ${today}. ` +
      `Use web_search ONLY for live/current data (today's news, live prices, real-time weather, recent events). ` +
      `DO NOT search for: greetings, math, coding, website building, general knowledge, or anything from your training. ` +
      `When you search${readUrl}, read 1 page at a time. Budget: ${budget} tool calls total.`
    );
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the web for LIVE/CURRENT information only: today\'s breaking news, live currency/stock prices, real-time weather, or very recent events (last 1-7 days). DO NOT use for: greetings ("hello"), coding tasks, math, website building, general knowledge, history, or anything you can answer from training data. When in doubt, answer directly without searching.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                "Short keyword search query, e.g. 'nobel prize physics 2026 winner'.",
            },
          },
          required: ['query'],
        },
      },
    };
  }
}
