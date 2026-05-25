import { z } from 'zod';

export const SearchIssuesInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  query: z
    .string()
    .min(1)
    .describe(
      'Plain keywords or a short phrase. Do NOT pass full GitHub search syntax — qualifiers like ' +
        '`repo:` and `is:issue` are added internally.',
    ),
  state: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.number().int().min(1).max(20).default(10),
});

export type SearchIssuesInput = z.infer<typeof SearchIssuesInput>;

export const SearchIssuesOutput = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    createdAt: z.string(),
  }),
);
export type SearchIssuesOutput = z.infer<typeof SearchIssuesOutput>;
