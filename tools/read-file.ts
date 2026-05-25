import { tool } from 'ai';
import { ReadFileInput, type ReadFileOutput } from '@/schemas/v1/tools/read-file';
import { getOctokit, cachedCall } from '@/github/client';

const MAX_BYTES = 100 * 1024;
const HEAD_BYTES = 50 * 1024;
const TAIL_BYTES = 10 * 1024;

export const readFileTool = tool({
  description:
    'Read a single file from the repository at a given path (and optional ref). Files larger than ' +
    '100KB are truncated to head + tail; the `truncated` flag indicates this.',
  inputSchema: ReadFileInput,
  execute: async ({ owner, repo, path, ref }): Promise<ReadFileOutput> => {
    const octokit = getOctokit();
    const res = await cachedCall(
      'repos.getContent.file',
      { owner, repo, path, ref: ref ?? null },
      () => octokit.rest.repos.getContent({ owner, repo, path, ref }),
    );
    const data = res.data as unknown;
    if (Array.isArray(data) || typeof data !== 'object' || data === null) {
      throw new Error(`Path ${path} is a directory or not a regular file. Use list_directory instead.`);
    }
    const file = data as { type?: string; size?: number; content?: string; encoding?: string };
    if (file.type !== 'file') {
      throw new Error(`Path ${path} is not a regular file (type=${file.type}).`);
    }
    const buffer = Buffer.from(file.content ?? '', (file.encoding as BufferEncoding) ?? 'base64');
    const size = file.size ?? buffer.length;
    if (buffer.length > MAX_BYTES) {
      const head = buffer.subarray(0, HEAD_BYTES).toString('utf8');
      const tail = buffer.subarray(buffer.length - TAIL_BYTES).toString('utf8');
      return {
        path,
        size,
        content: `${head}\n\n... [truncated ${buffer.length - HEAD_BYTES - TAIL_BYTES} bytes] ...\n\n${tail}`,
        truncated: true,
      };
    }
    return { path, size, content: buffer.toString('utf8'), truncated: false };
  },
});
