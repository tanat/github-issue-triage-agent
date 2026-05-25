import { tool } from 'ai';
import { GetIssueInput, type GetIssueOutput } from '@/schemas/v1/tools/get-issue';
import { getOctokit, cachedCall } from '@/github/client';

export const getIssueTool = tool({
  description:
    'Fetch a GitHub issue with its body, labels, reactions, and full comment thread. ' +
    'Use this as the first step in any triage to understand what the user is reporting.',
  inputSchema: GetIssueInput,
  execute: async ({ owner, repo, number }): Promise<GetIssueOutput> => {
    const octokit = getOctokit();
    const issue = await cachedCall(
      'issues.get',
      { owner, repo, number },
      () => octokit.rest.issues.get({ owner, repo, issue_number: number }),
    );
    const comments = await cachedCall(
      'issues.listComments',
      { owner, repo, number },
      () =>
        octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: number,
          per_page: 100,
        }),
    );

    const reactions: Record<string, number> = {};
    const r = issue.data.reactions ?? {};
    for (const key of ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']) {
      const v = (r as Record<string, unknown>)[key];
      if (typeof v === 'number' && v > 0) reactions[key] = v;
    }

    return {
      number: issue.data.number,
      title: issue.data.title,
      state: issue.data.state,
      body: issue.data.body ?? '',
      author: issue.data.user?.login ?? null,
      createdAt: issue.data.created_at,
      labels: (issue.data.labels ?? []).map((l) =>
        typeof l === 'string' ? l : (l.name ?? ''),
      ).filter(Boolean),
      comments: comments.data.map((c) => ({
        author: c.user?.login ?? null,
        body: c.body ?? '',
        createdAt: c.created_at,
      })),
      reactionSummary: Object.keys(reactions).length > 0 ? reactions : undefined,
    };
  },
});
