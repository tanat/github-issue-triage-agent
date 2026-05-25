import { z } from 'zod';

export const GetIssueInput = z.object({
  owner: z.string().min(1).describe('GitHub repository owner (e.g. "shadcn-ui").'),
  repo: z.string().min(1).describe('GitHub repository name (e.g. "ui").'),
  number: z
    .number()
    .int()
    .positive()
    .describe('The issue number (the integer after #).'),
});

export type GetIssueInput = z.infer<typeof GetIssueInput>;

export const GetIssueOutput = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  body: z.string(),
  author: z.string().nullable(),
  createdAt: z.string(),
  labels: z.array(z.string()),
  comments: z.array(
    z.object({
      author: z.string().nullable(),
      body: z.string(),
      createdAt: z.string(),
    }),
  ),
  reactionSummary: z.record(z.string(), z.number()).optional(),
});

export type GetIssueOutput = z.infer<typeof GetIssueOutput>;
