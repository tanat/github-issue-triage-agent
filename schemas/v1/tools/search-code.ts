import { z } from 'zod';

export const SearchCodeInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  query: z.string().min(1).describe('Code phrase, identifier, or symbol to search for.'),
  fileExtension: z
    .string()
    .optional()
    .describe('Optional file extension to constrain results (e.g. "tsx", "ts", "md").'),
  limit: z.number().int().min(1).max(20).default(10),
});

export type SearchCodeInput = z.infer<typeof SearchCodeInput>;

export const SearchCodeOutput = z.array(
  z.object({
    path: z.string(),
    lineNumber: z.number().int().nullable(),
    snippet: z.string(),
  }),
);
export type SearchCodeOutput = z.infer<typeof SearchCodeOutput>;
