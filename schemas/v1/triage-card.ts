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

// --- Tolerant parsing layer ------------------------------------------------
//
// The strict `TriageCard` above stays the canonical type for every downstream
// consumer. `TriageCardLenient` is used ONLY to parse raw model JSON: it
// normalizes a handful of recurring, benign formatting quirks observed across
// providers (Sonnet/Gemini/GPT-4o) and then pipes the result into the strict
// schema, so its output type is exactly `TriageCard`.
//
// What it normalizes (and only these — it never invents or defaults missing
// fields; a genuinely incomplete card still fails strict validation):
//   - suspectedFiles[].confidence emitted as a probability number (0.9) instead
//     of the enum → bucketed to high/medium/low.
//   - severity emitted as null / "" / "none" → dropped (the field is optional).
//   - draftResponse over the 1500-char cap → clamped to 1500.
//
// Observed in eval logs as the cause of ~half the null cards; see
// evals/__tests__ and learn/05-typed-output.md.

function normalizeConfidence(v: unknown): unknown {
  if (typeof v === 'number') {
    if (v >= 0.8) return 'high';
    if (v >= 0.5) return 'medium';
    return 'low';
  }
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (s === 'very high' || s === 'very_high' || s === 'certain') return 'high';
    if (s === 'very low') return 'low';
    return s;
  }
  return v;
}

export const TriageCardLenient = z.preprocess((raw) => {
  if (raw === null || typeof raw !== 'object') return raw;
  const o: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (o.severity === null || o.severity === '') {
    delete o.severity;
  } else if (typeof o.severity === 'string') {
    const s = o.severity.toLowerCase().trim();
    if (s === '' || s === 'none' || s === 'n/a' || s === 'na') delete o.severity;
    else o.severity = s;
  }

  if (typeof o.draftResponse === 'string' && o.draftResponse.length > 1500) {
    o.draftResponse = o.draftResponse.slice(0, 1500);
  }

  if (Array.isArray(o.suspectedFiles)) {
    o.suspectedFiles = o.suspectedFiles.map((f) =>
      f && typeof f === 'object'
        ? { ...(f as Record<string, unknown>), confidence: normalizeConfidence((f as Record<string, unknown>).confidence) }
        : f,
    );
  }

  return o;
}, TriageCard);

// Scan `text` for balanced, string-aware top-level `{...}` objects. Braces that
// appear inside JSON string values are ignored, so a draftResponse containing
// "}" doesn't truncate the object. Code snippets in surrounding prose (e.g.
// `{ hasBorder?: boolean }`) come back as candidates too, but fail JSON.parse /
// schema validation in extractTriageCard and are discarded.
function topLevelJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

// Pull the TriageCard out of a model's free-form final text. Replaces the old
// first-`{`-to-last-`}` slice, which broke whenever the model wrapped code
// snippets (with their own braces) around the JSON. We instead collect every
// balanced top-level object and return the LAST one that both parses as JSON
// and validates against the lenient schema — the final answer typically comes
// last, after any reasoning prose.
export function extractTriageCard(text: string): TriageCard | null {
  if (!text) return null;
  // The model often wraps JSON in a ```json fence despite instructions; prefer
  // the fenced body, then fall back to scanning the whole text.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const sources = fenced ? [fenced[1], text] : [text];
  for (const src of sources) {
    const candidates = topLevelJsonObjects(src);
    for (let i = candidates.length - 1; i >= 0; i--) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(candidates[i]);
      } catch {
        continue;
      }
      const result = TriageCardLenient.safeParse(parsed);
      if (result.success) return result.data;
    }
  }
  return null;
}
