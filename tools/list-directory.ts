import { tool } from 'ai';
import {
  ListDirectoryInput,
  type ListDirectoryOutput,
} from '@/schemas/v1/tools/list-directory';
import { getOctokit, cachedCall } from '@/github/client';

const allowedTypes = new Set(['file', 'dir', 'symlink', 'submodule']);

export const listDirectoryTool = tool({
  description:
    'List entries in a repository directory. Use to orient yourself in an unfamiliar repo or to ' +
    'find candidate files before reading.',
  inputSchema: ListDirectoryInput,
  execute: async ({ owner, repo, path, ref }): Promise<ListDirectoryOutput> => {
    const octokit = getOctokit();
    const res = await cachedCall(
      'repos.getContent.dir',
      { owner, repo, path: path ?? '', ref: ref ?? null },
      () => octokit.rest.repos.getContent({ owner, repo, path: path ?? '', ref }),
    );
    const data = res.data;
    if (!Array.isArray(data)) {
      throw new Error(`Path ${path} is not a directory. Use read_file instead.`);
    }
    return data
      .filter((entry) => allowedTypes.has(entry.type))
      .map((entry) => ({
        name: entry.name,
        type: entry.type as ListDirectoryOutput[number]['type'],
        size: entry.type === 'file' ? entry.size : undefined,
      }));
  },
});
