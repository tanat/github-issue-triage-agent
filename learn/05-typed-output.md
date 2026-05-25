# Typed output: TriageCard from text + extract + Zod

## Why you can't just `streamObject`

A logical question: "if I need a typed JSON output, why not use `streamObject` or `generateObject` with the `TriageCard` schema?"

Because `streamObject` **doesn't work in agent mode with tool calls**. More precisely, it works, but in "one payload" — gives you structured output, not a chain tool_call → tool_result → tool_call → ... → final_object. If you want to *first call tools and then get a typed final* — you have two options:

1. **Text final + post-parse.** What we do. The model writes JSON in ordinary text, we extract it with regex, validate via Zod.
2. **Terminal tool.** Add `submit_triage_card` as a 7th tool with input schema `TriageCard`. The model "calls" this tool as the final. Realistic, but adds an extra step.

In our code option 1 is chosen. Why:

- **Sonnet 4.6 reliably writes valid JSON to the schema** if the system prompt clearly states the contract.
- A terminal tool complicates the cleanup pipeline and requires that `stopWhen: hasToolCall('submit_triage_card')` integrate with the rest of the logic.
- Post-parse gives us a fallback — `extractCard()` can pull JSON even from a cap-hit trace (see `04-stopping-conditions.md`).

> This is a normal pattern ([Vercel AI SDK deep dive](https://www.digitalapplied.com/blog/vercel-ai-sdk-6-deep-dive-features-tool-calls-2026)). An alternative path via [`experimental_output`](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) exists at Vercel, but for agents with many tools it's less mature.

---

## Schema: `TriageCard`

From `schemas/v1/triage-card.ts`:

```ts
export const SCHEMA_VERSION = 'v1.0.0' as const;

export const Category = z.enum([
  'bug', 'feature', 'docs', 'question', 'duplicate', 'wontfix', 'invalid', 'other',
]);

export const Severity = z.enum(['critical', 'high', 'medium', 'low']);

export const SuspectedFile = z.object({
  path: z.string().min(1).describe(
    'Repo-relative file path verified via read_file or surfaced via search_code / get_file_history. Do NOT invent paths.',
  ),
  rationale: z.string().min(10).describe('One sentence explaining why this file is suspected.'),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const SimilarIssue = z.object({
  number: z.number().int().positive().describe(
    'Issue number verified via search_issues. Do NOT invent numbers.',
  ),
  title: z.string().min(1),
  relevance: z.enum(['exact_duplicate', 'closely_related', 'tangentially_related']),
});

export const TriageCard = z.object({
  category: Category,
  severity: Severity.optional(),
  suspectedFiles: z.array(SuspectedFile).max(5),
  similarIssues: z.array(SimilarIssue).max(5),
  draftResponse: z.string().min(20).max(1500),
  reasoning: z.string().min(20),
});
```

Every decision here is justified:

### `category` — enum, not free text

If this were a string — the model would write "probably a bug, but could also be a docs issue", and you'd have to parse it. An enum forces the choice. 8 values is a wide spectrum, and `'other'` is there as an escape valve.

Why 8 and not 4? Because conflating "duplicate" with "bug" loses information for downstream analytics. A duplicate is a "close-as-duplicate" route, a bug is "fix-and-merge".

### `severity` — `.optional()` with a conditional contract

`severity` only makes sense for `category === 'bug'`. Zod can't do conditional optional in a simple form, but we spell out the rule in the system prompt:

> `severity` (optional): critical | high | medium | low — only set when `category === "bug"`.

This is **soft enforcement** on the prompt side. Hard could be done via `z.discriminatedUnion`, but that lengthens the schema and complicates error diagnostics. For our scope — a compromise.

### `suspectedFiles` — cap of 5 and required rationale

```ts
suspectedFiles: z.array(SuspectedFile).max(5)
```

Why 5? Empirically: above 5 files the model can no longer explain them, and the rationale degrades to "this file might be relevant". The cap forces prioritization.

`rationale: z.string().min(10)` — forces the model to write at least something. Without `.min(10)` Sonnet 4.6 may slip in "Looks important." and move on. With a minimum length — at least a sentence.

`path: z.string().min(1).describe('... Do NOT invent paths.')` — the description lands in the JSON Schema the model sees, and works as an in-context instruction. A micro-prompt.

### `similarIssues` — numbers, not URLs

```ts
number: z.number().int().positive().describe(
  'Issue number verified via search_issues. Do NOT invent numbers.',
)
```

Why `number`, not `url`? URLs the model can hallucinate — `https://github.com/owner/repo/issues/9999` without verification. A number forces it to be a real issue that came from `search_issues` (otherwise the model doesn't know what numbers are in the repo).

### `draftResponse` — min 20, max 1500

This is the final text the maintainer will paste into a comment. Min 20 — against "Thanks!". Max 1500 — against walls of LLM-style text.

### `reasoning` — required self-reflection

This is **not for the model**, it's for you. When you look at a trace a week later, the `reasoning` field explains "why I arrived at this category and these files". It's the link between the trajectory and the final.

---

## Extraction: `extractCard()`

From `agent/run.ts:131`:

```ts
function extractCard(text: string): TriageCardType | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = TriageCard.safeParse(JSON.parse(candidate.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

It's `~10 lines`, but each is needed. Let's break it down:

### Step 1: regex on code fences

```ts
const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
const candidate = fenced ? fenced[1] : text;
```

Sonnet 4.6 loves to **wrap JSON in markdown fences**, even if the prompt says "no markdown fences". It's in the model's nature — it learned on markdown. The regex catches `\`\`\`json ... \`\`\`` and plain `\`\`\` ... \`\`\``.

If there are no fences — take the whole text as is.

A subtlety: `[\s\S]*?` (non-greedy) instead of `.*?` — because `.` doesn't match newlines by default. On multiline JSON you'd lose everything.

### Step 2: first `{` and last `}`

```ts
const start = candidate.indexOf('{');
const end = candidate.lastIndexOf('}');
```

The model often writes prose before and after the JSON: "Here is the triage card:\n\n{ ... }\n\nLet me know if you need more details." We take from the first `{` to the last `}` — this gives us the "outermost" JSON, cutting off prose.

This is robust against **nested objects** (because `lastIndexOf('}')` finds the last closing brace, which closes the outer object). It's not robust against **two JSON objects in one text** — but Sonnet 4.6 doesn't do that on our prompt.

### Step 3: `JSON.parse` + `Zod.safeParse`

```ts
const parsed = TriageCard.safeParse(JSON.parse(candidate.slice(start, end + 1)));
return parsed.success ? parsed.data : null;
```

Double validation:

- `JSON.parse` — syntax;
- `TriageCard.safeParse` — semantics (enums, length, required fields).

`safeParse` matters because plain `.parse` throws — and we have a `try/catch` already, but `safeParse` gives us `.error` for logging (we don't use this yet, but the slot is there).

### Two-step fallback in `runTriageOnce`

```ts
let card: TriageCardType | null = extractCard(result.text ?? '');
if (!card) {
  for (let i = allStepTexts.length - 1; i >= 0; i--) {
    card = extractCard(allStepTexts[i]);
    if (card) break;
  }
}
```

`result.text` is the model's final text. If JSON is there, we take it.

If not (cap-hit, or the model didn't write a final) — we walk through `allStepTexts` in **reverse order**. This rescues the case "the model already formulated 'almost a final' in an intermediate step, but then went into another tool_call and hit the cap".

On hard issues this gives +5–10% completeness.

---

## What to do if `extractCard` returned `null`

That means:

1. The final wasn't written, and no JSON was found in step_text either;
2. or JSON exists, but doesn't validate against the schema.

In the UI (`runTriage`) we emit ordinary text via the stream — the user sees that something went wrong, or looks at logs.

In eval (`runTriageOnce`) we return `card: null`, and `scoreCompleteness` = 0, `categoryAccuracy` = 0. This penalizes the run in aggregate.

What **not** to do:

- **Don't "fix" the JSON programmatically.** If you start sneaking in missing fields with defaults, you'll mask a prompt regression. Better fail loud.
- **Don't re-call the model** asking it to "reformat". This bloats the agent and measures poorly.

The best strategy — **improve the prompt and check via evals**. If `completeness < 0.9` on our corpus — that's a signal to redo the system prompt.

---

## Schema versioning: `SCHEMA_VERSION`

```ts
export const SCHEMA_VERSION = 'v1.0.0' as const;
```

And in `evals/harness.ts`:

```ts
import { SCHEMA_VERSION } from '@/schemas/v1/triage-card';
// ...
row: { schemaVersion: SCHEMA_VERSION, ... }
```

Why this is:

- When you change the schema (added a new field, renamed an enum), old `evals/results.json` may become non-comparable. A version in the record lets you filter "only runs with schema v2.0.0".
- The SQLite log also stores `schema_version` — you can filter trajectories by version.
- On a major change (`v1` → `v2`) you copy the file into `schemas/v2/` and switch the import. Old fixtures remain compatible with the old schema.

The folder `schemas/v2/` is already created and empty — a placeholder for a future breakage. Right now we're on v1.0.0.

---

## Alternative: tool-as-terminator

If we wanted a hard guarantee of a typed final, we could do it like this:

```ts
const submitTriageCard = tool({
  description: 'Submit the final triage card. This stops the agent.',
  inputSchema: TriageCard,
  execute: async (card) => ({ submitted: true, card }),
});

// In streamText:
stopWhen: [stepCountIs(8), hasToolCall('submit_triage_card')],
```

Pros:

- the model **physically cannot** send invalid JSON — Zod validation on the input schema rejects it;
- the final is a tool_call, easy to extract programmatically (`result.toolCalls.find(c => c.toolName === 'submit_triage_card')`).

Cons:

- an extra step (~$0.003 per run);
- the model sometimes forgets to call the tool and writes a prose final → a fallback is still needed;
- a complex schema inside tool input may bug out on different providers (some SDK strict modes don't like deeply nested ones).

In evals the completeness difference is about 1–2%. Doesn't justify the complication for this task. For project 04, where there will be orchestration, we'll switch to a terminal-tool.

---

## What to try

1. **Break the regex on code fences.** Run on an issue where the model writes JSON without fences — check that `extractCard` still catches it.
2. **Add a field `confidence_in_triage` (0–1)** to `TriageCard`. Run 5 fixtures, see how Sonnet 4.6 calibrates — usually overconfident at 0.85–0.95.
3. **Swap a `category`**: rename `duplicate` → `is_duplicate`. Run evals. `categoryAccuracy` should drop, because the prompt instructions say the old name. Look in `runs/*.json` — the model will write `"category": "duplicate"`, valid parsing fails. This will give you a feel for how fragile the enum-name + prompt contract is.

Next — `06-observability.md`: SQLite trace, `inspect-trace`, and how to live with this.
