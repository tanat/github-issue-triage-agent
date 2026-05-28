import { tool } from 'ai';
import { SearchIssuesInput, type SearchIssuesOutput } from '@/schemas/v1/tools/search-issues';
import { getOctokit, cachedCall } from '@/github/client';

export const searchIssuesTool = tool({
  description:
    'Search issues in this repository by keywords. Use to find related or duplicate issues. ' +
    'Pass plain keywords; do not include `repo:` or `is:issue` qualifiers — they are added for you.',
  inputSchema: SearchIssuesInput,
  execute: async ({ owner, repo, query, state, limit }): Promise<SearchIssuesOutput> => {
    const octokit = getOctokit();
    const stateQual = state !== 'all' ? ` state:${state}` : '';
    const q = `${query} repo:${owner}/${repo} is:issue${stateQual}`;
    const res = await cachedCall(
      'search.issuesAndPullRequests',
      { q, limit },
      () =>
        octokit.rest.search.issuesAndPullRequests({
          q,
          per_page: limit,
          advanced_search: 'true',
        }),
    );
    return res.data.items.map((i) => ({
      number: i.number,
      title: `<untrusted>\n${i.title}\n</untrusted>`,
      state: i.state,
      createdAt: i.created_at,
    }));
  },
});
