import { z } from 'zod';

export const ReadFileInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().min(1).describe('File path within the repo, e.g. "components/ui/dialog.tsx".'),
  ref: z
    .string()
    .optional()
    .describe('Branch, tag, or commit SHA. Defaults to the repo default branch.'),
});

export type ReadFileInput = z.infer<typeof ReadFileInput>;

export const ReadFileOutput = z.object({
  path: z.string(),
  size: z.number().int(),
  content: z.string(),
  truncated: z.boolean(),
});
export type ReadFileOutput = z.infer<typeof ReadFileOutput>;
