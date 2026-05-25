import { tool } from 'ai';
import { SearchCodeInput, type SearchCodeOutput } from '@/schemas/v1/tools/search-code';
import { getOctokit, cachedCall } from '@/github/client';

export const searchCodeTool = tool({
  description:
    'Search source code in this repository for a phrase or identifier. Use to locate where a ' +
    'function, constant, or string literal is defined. Requires GitHub authentication.',
  inputSchema: SearchCodeInput,
  execute: async ({ owner, repo, query, fileExtension, limit }): Promise<SearchCodeOutput> => {
    const octokit = getOctokit();
    const extQual = fileExtension ? ` extension:${fileExtension.replace(/^\./, '')}` : '';
    const q = `${query} repo:${owner}/${repo}${extQual}`;
    const res = await cachedCall(
      'search.code',
      { q, limit },
      () =>
        octokit.rest.search.code({
          q,
          per_page: limit,
          headers: { accept: 'application/vnd.github.text-match+json' },
        }),
    );
    return res.data.items.map((item) => {
      const fragment =
        (item as unknown as { text_matches?: Array<{ fragment?: string }> }).text_matches?.[0]
          ?.fragment ?? '';
      return {
        path: item.path,
        lineNumber: null,
        snippet: fragment.slice(0, 400),
      };
    });
  },
});
