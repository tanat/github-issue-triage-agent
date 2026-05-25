import { z } from 'zod';

export const GetFileHistoryInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(10),
});

export type GetFileHistoryInput = z.infer<typeof GetFileHistoryInput>;

export const GetFileHistoryOutput = z.array(
  z.object({
    sha: z.string(),
    message: z.string(),
    author: z.string().nullable(),
    date: z.string().nullable(),
    linkedRefs: z.array(z.number().int().positive()),
  }),
);
export type GetFileHistoryOutput = z.infer<typeof GetFileHistoryOutput>;
