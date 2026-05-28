import { tool } from 'ai';
import {
  GetFileHistoryInput,
  type GetFileHistoryOutput,
} from '@/schemas/v1/tools/get-file-history';
import { getOctokit, cachedCall } from '@/github/client';

const REF_RE = /#(\d+)/g;

export const getFileHistoryTool = tool({
  description:
    'List recent commits that modified a file, including extracted issue/PR references from each ' +
    'commit message. Use to find when a file was last changed and which PR did it.',
  inputSchema: GetFileHistoryInput,
  execute: async ({ owner, repo, path, limit }): Promise<GetFileHistoryOutput> => {
    const octokit = getOctokit();
    const res = await cachedCall(
      'repos.listCommits',
      { owner, repo, path, limit },
      () => octokit.rest.repos.listCommits({ owner, repo, path, per_page: limit }),
    );
    return res.data.map((c) => {
      const message = c.commit.message ?? '';
      const refs = new Set<number>();
      for (const m of message.matchAll(REF_RE)) refs.add(Number(m[1]));
      const subject = message.split('\n')[0];
      return {
        sha: c.sha,
        message: `<untrusted>\n${subject}\n</untrusted>`,
        author: c.commit.author?.name ?? c.author?.login ?? null,
        date: c.commit.author?.date ?? null,
        linkedRefs: [...refs],
      };
    });
  },
});
