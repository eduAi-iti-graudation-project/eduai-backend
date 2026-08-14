import { z } from 'zod';

export const SearchWebInputSchema = z.object({
  query: z.string().min(1).max(300),
  maxResults: z.number().int().min(1).max(10).default(5),
});

export const SearchWebOutputSchema = z.object({
  results: z.string(),
  count: z.number(),
  items: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
    }),
  ),
});

export type SearchWebInput = z.infer<typeof SearchWebInputSchema>;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export function createWebSearchTool(apiKey?: string) {
  return {
    inputSchema: SearchWebInputSchema,
    outputSchema: SearchWebOutputSchema,
    execute: async (
      input: SearchWebInput,
    ): Promise<z.infer<typeof SearchWebOutputSchema>> => {
      if (!apiKey) {
        return {
          results: 'Web search is currently unavailable.',
          count: 0,
          items: [],
        };
      }

      let results: TavilyResult[];
      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: input.query,
            max_results: input.maxResults,
            search_depth: 'basic',
          }),
        });

        if (!response.ok) {
          return {
            results: 'Web search failed. Please try again.',
            count: 0,
            items: [],
          };
        }

        const data = (await response.json()) as { results?: TavilyResult[] };
        results = data.results ?? [];
      } catch {
        return {
          results: 'Web search failed. Please try again.',
          count: 0,
          items: [],
        };
      }

      if (results.length === 0) {
        return {
          results: 'No relevant web results found.',
          count: 0,
          items: [],
        };
      }

      const text = results
        .map(
          (r, idx) =>
            `[Result ${idx + 1}] ${r.title ?? 'Untitled'} — ${r.url ?? ''}\n${r.content ?? ''}`,
        )
        .join('\n\n');

      return {
        results: text,
        count: results.length,
        items: results.map((r) => ({
          title: r.title ?? 'Untitled',
          url: r.url ?? '',
        })),
      };
    },
  };
}
