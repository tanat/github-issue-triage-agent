import { z } from 'zod';

export const SCHEMA_VERSION = 'v1.0.0' as const;

export const Category = z.enum([
  'bug',
  'feature',
  'docs',
  'question',
  'duplicate',
  'wontfix',
  'invalid',
  'other',
]);
export type Category = z.infer<typeof Category>;

export const Severity = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof Severity>;

export const SuspectedFile = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Repo-relative file path verified via read_file or surfaced via search_code / get_file_history. Do NOT invent paths.',
    ),
  rationale: z
    .string()
    .min(10)
    .describe('One sentence explaining why this file is suspected.'),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type SuspectedFile = z.infer<typeof SuspectedFile>;

export const SimilarIssue = z.object({
  number: z
    .number()
    .int()
    .positive()
    .describe('Issue number verified via search_issues. Do NOT invent numbers.'),
  title: z.string().min(1),
  relevance: z.enum(['exact_duplicate', 'closely_related', 'tangentially_related']),
});
export type SimilarIssue = z.infer<typeof SimilarIssue>;

export const TriageCard = z.object({
  category: Category,
  severity: Severity.optional(),
  suspectedFiles: z.array(SuspectedFile).max(5),
  similarIssues: z.array(SimilarIssue).max(5),
  draftResponse: z
    .string()
    .min(20)
    .max(1500)
    .describe('Polite, professional comment ready for a maintainer to post.'),
  reasoning: z
    .string()
    .min(20)
    .describe('2–3 sentences summarising the investigation: which steps led where.'),
});

export type TriageCard = z.infer<typeof TriageCard>;
