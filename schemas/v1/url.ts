import { z } from 'zod';

export const ParsedIssueUrl = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
  type: z.enum(['issue', 'pull']),
});

export type ParsedIssueUrl = z.infer<typeof ParsedIssueUrl>;
