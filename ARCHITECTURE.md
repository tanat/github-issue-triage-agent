# Architecture — GitHub Issue Triage Agent

> Technical decisions and rationale. The main architectural leitmotif of the project is **designing the tool set so that an LLM consumer uses them correctly on the first try**, plus the right combination of `stopWhen`, call deduplication, and a budget cap for the agent to wrap up within budget.

---

## Stack

| Layer | Technology | Version / comment |
|------|------------|----------------------|
| Framework | Next.js 15 App Router | React 19 |
| Language | TypeScript strict | discriminated unions for tool I/O |
| Styling | Tailwind CSS + shadcn/ui | trace viewer + final card |
| AI SDK | Vercel AI SDK v6 | `streamText` + `tools` + `stopWhen` + `prepareStep` |
| Schema validation | Zod 4 | per-tool input + final output |
| Model routing | Vercel AI Gateway | `gateway('anthropic/claude-sonnet-4-6')`, `gateway('openai/gpt-4o')` — one key, no per-provider SDKs |
| Primary model | Claude Sonnet 4.6 | `claude-sonnet-4-6` via Gateway — best trajectory quality, gets ephemeral prompt caching |
| Comparison models | gpt-4o (Gateway), Gemini 2.5 Flash / Pro (direct `@ai-sdk/google`) | cross-model evals |
| GitHub client | `@octokit/rest` | `advanced_search: 'true'` on issue search, `accept: vnd.github.text-match+json` on code search |
| Observability log | better-sqlite3 | per-step row, queryable |
| Tracing | Langfuse + OpenTelemetry (`@langfuse/otel`, `@langfuse/tracing`) | one trace per run; spans carry token cost + latency; grouped by issue `sessionId`, tagged by model |
| Fixtures storage | JSON files | committed |
| Deploy | Vercel | env: `AI_GATEWAY_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (optional), `GITHUB_TOKEN` |

**Intentionally not used:** GitHub's GraphQL API (REST is enough), webhooks, mutating operations (read-only agent), Redis cache (Octokit has one built in, plus a SQLite-cache table on dev).

---

## Data source

GitHub REST API via Octokit:

```ts
import { Octokit } from '@octokit/rest';
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
```

With a PAT — 5000 requests per hour. More than enough for pet-project scope.

Endpoints used:

| Endpoint | Octokit method | Used in tool |
|----------|----------------|---------------------|
| `GET /repos/{o}/{r}/issues/{n}` | `octokit.rest.issues.get` | `get_issue` |
| `GET /repos/{o}/{r}/issues/{n}/comments` | `octokit.rest.issues.listComments` | `get_issue` |
| `GET /search/issues` | `octokit.rest.search.issuesAndPullRequests` | `search_issues` |
| `GET /search/code` | `octokit.rest.search.code` | `search_code` |
| `GET /repos/{o}/{r}/contents/{path}` | `octokit.rest.repos.getContent` | `read_file`, `list_directory` |
| `GET /repos/{o}/{r}/commits` | `octokit.rest.repos.listCommits` | `get_file_history` |

For each closed issue — ground truth extraction:
- `octokit.rest.issues.listEventsForTimeline` finds `cross-referenced` events with PRs
- From each PR → `octokit.rest.pulls.listFiles` → set of changed files

This is automated in `scripts/build-fixtures.ts`.

---

## Data flow

```
                            User input (issue URL)
                                        │
                                        ▼
                            app/page.tsx (client)
                                        │
                              experimental_useObject + custom hook
                              consumes streamed events
                                        │
                                        ▼
                          POST /api/triage (server route)
                                        │
                                        ▼
                  streamText({
                    model: gateway('anthropic/claude-sonnet-4-6'),
                    messages: [systemWithCacheMarker, userMessage],
                    tools: { get_issue, search_issues, ... },
                    stopWhen: stepCountIs(8),
                    prepareStep: withAnthropicCache(dedupRecentToolCalls),
                    onStepFinish: logStep,
                  })
                                        │
                                        ▼
                  ┌────────────────────┴────────────────────┐
                  │                                          │
                  ▼                                          ▼
           Tool execution                         Step events streamed
           (Octokit calls,                        (tool name, args, result)
            cached in SQLite)                              │
                  │                                          ▼
                  └─────────► tool result ──────► next model step
                                                            │
                                                            ▼
                                                  Final triage card
                                                  (extracted from result.text via extractCard()
                                                   + Zod safeParse)
                                                            │
                                                            ▼
                                                  Persisted to runs/{run_id}.json
                                                  + SQLite per-step log
```

---

## Repo structure

```
gh-issue-triage/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                     # main UI: URL input + trace + card
│   ├── eval/page.tsx                # eval results dashboard
│   └── api/
│       └── triage/route.ts          # streamText handler
│
├── schemas/
│   ├── v1/
│   │   ├── triage-card.ts           # TriageCard final shape
│   │   ├── tools/                   # per-tool input/output schemas
│   │   │   ├── get-issue.ts
│   │   │   ├── search-issues.ts
│   │   │   ├── search-code.ts
│   │   │   ├── read-file.ts
│   │   │   ├── list-directory.ts
│   │   │   └── get-file-history.ts
│   │   └── url.ts                   # parsed GitHub issue URL
│   └── v2/
│
├── github/
│   ├── client.ts                    # Octokit instance + cache wrapper
│   ├── parse-url.ts                 # GitHub URL → { owner, repo, number }
│   └── cache/                       # SQLite: cache table for API responses
│       └── cache.ts                 # get/set with TTL
│
├── tools/
│   ├── registry.ts                  # exports `tools` for streamText
│   ├── get-issue.ts                 # tool definition + execute
│   ├── search-issues.ts
│   ├── search-code.ts
│   ├── read-file.ts
│   ├── list-directory.ts
│   ├── get-file-history.ts
│   └── __helpers__/
│       └── dedup.ts                 # prepareStep helper
│
├── agent/
│   ├── system-prompt.ts             # exports SYSTEM_PROMPT_V1, PROMPT_VERSION
│   ├── run.ts                       # streamText + generateText wrappers (modelFor uses gateway())
│   ├── prepare-step-cache.ts        # withAnthropicCache: rolling-tail ephemeral cache breakpoint
│   └── log.ts                       # SQLite step log
│
├── render/
│   ├── TraceView.tsx                # left: streaming agent steps
│   ├── StepCard.tsx                 # one step (tool name + args + result)
│   ├── TriageCardView.tsx           # right: final structured output
│   └── DiffView.tsx                 # for eval: actual vs ground truth
│
├── fixtures/
│   ├── issues.json                  # 25 issue refs + ground truth
│   └── README.md                    # rationale per issue
│
├── scripts/
│   ├── build-fixtures.ts            # given issue list, fetches ground truth from linked PRs
│   └── inspect-trace.ts             # CLI: read SQLite log, print formatted trace
│
├── evals/
│   ├── harness.ts                   # `pnpm eval` runs all fixtures
│   ├── score.ts                     # category, file recall, trajectory metrics
│   ├── results.json                 # append-only history
│   └── README.md
│
├── logs/
│   └── steps.sqlite                 # per-step log
│
├── runs/                            # one JSON per agent run
│   └── {run_id}.json
│
├── DECISIONS.md
└── README.md
```

---

## Tool design

Six tools. Granularity is chosen so that each one does **one clear thing** and doesn't overlap with its neighbors.

### `get_issue`

```ts
inputSchema: z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
});

outputShape: {
  number, title, state, body, author, createdAt, labels: string[],
  comments: Array<{ author, body, createdAt }>,
  reactionSummary: { '+1': number, ... },
}
```

Returns issue + comments + labels + reactions in a single call. This is the first step of any triage task.

### `search_issues`

```ts
inputSchema: z.object({
  owner: z.string(),
  repo: z.string(),
  query: z.string().describe(
    'Keywords or phrase, NOT a full GitHub search query. ' +
    'Internally we add `repo:owner/repo` and `is:issue`.'
  ),
  state: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.number().int().min(1).max(20).default(10),
});

outputShape: Array<{ number, title, state, createdAt, similarity: 'high' | 'medium' | 'low' }>;
```

**Important:** the agent does not write a full GitHub search query (`repo:foo/bar is:issue OR ...`) — it's too easy to hallucinate the syntax. The tool accepts simple keywords and adds qualifiers itself.

The Octokit call passes `advanced_search: 'true'`. Without this flag GitHub's issue-search endpoint returns an empty result set for any non-trivial query.

### `search_code`

```ts
inputSchema: z.object({
  owner: z.string(),
  repo: z.string(),
  query: z.string().describe('Code phrase or identifier to search for'),
  fileExtension: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

outputShape: Array<{ path, lineNumber, snippet }>;
```

GitHub Code Search. Useful for "find where function X is defined" or "where constant Y is referenced".

The Octokit call passes `headers: { accept: 'application/vnd.github.text-match+json' }`. Without this accept header, `text_matches[].fragment` comes back empty and the agent has only a file path to reason about — useless. With it, each result carries a 400-char snippet around the match.

### `read_file`

```ts
inputSchema: z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string(),
  ref: z.string().optional().describe('branch, tag, or commit SHA; defaults to default branch'),
});

outputShape: {
  path, size: number, content: string, truncated: boolean,
}
```

If the file is larger than 100KB — `truncated: true` and the head + tail is returned. The agent narrows in via `search_code` or `get_file_history` for specific locations.

### `list_directory`

```ts
inputSchema: z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string().default(''),
  ref: z.string().optional(),
});

outputShape: Array<{ name, type: 'file' | 'dir', size?: number }>;
```

For orientation in an unfamiliar repo.

### `get_file_history`

```ts
inputSchema: z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string(),
  limit: z.number().int().min(1).max(20).default(10),
});

outputShape: Array<{
  sha, message, author, date,
  // First line of message + linked PR/issue numbers extracted via regex
  linkedRefs: number[],
}>;
```

Returns the latest commits touching the file, with extracted PR/issue links. Helps the agent find "when this file last broke in a similar way".

See [DECISIONS.md](./DECISIONS.md) for the rationale behind tool granularity and the keywords-only input contract.

---

## Agent loop

```ts
// agent/run.ts
import { streamText, stepCountIs, gateway, type ModelMessage } from 'ai';
import { google } from '@ai-sdk/google';
import { tools } from '@/tools/registry';
import { systemPrompt } from '@/agent/system-prompt';
import { logStep } from '@/agent/log';
import { dedupRecentToolCalls } from '@/tools/__helpers__/dedup';
import { withAnthropicCache } from '@/agent/prepare-step-cache';

export function modelFor(key: ModelKey) {
  if (key === 'gpt-4o') return gateway('openai/gpt-4o');
  if (key === 'gemini-flash') return google('gemini-2.5-flash');
  if (key === 'gemini-pro') return google('gemini-2.5-pro');
  return gateway('anthropic/claude-sonnet-4-6');
}

export function runTriage({ issueUrl, parsedSummary, modelKey, runId }) {
  const isAnthropic = modelKey === 'sonnet';
  const messages: ModelMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
      ...(isAnthropic && {
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      }),
    },
    { role: 'user', content: `Triage this GitHub issue: ${issueUrl}\n${parsedSummary}` },
  ];

  return streamText({
    model: modelFor(modelKey),
    messages,
    tools,
    stopWhen: stepCountIs(8),
    prepareStep: isAnthropic
      ? withAnthropicCache(dedupRecentToolCalls)
      : dedupRecentToolCalls,
    onStepFinish: ({ toolCalls, toolResults, usage, finishReason, text }) => {
      logStep({ runId, /* ... */ });
    },
  });
}
```

The `messages` form (instead of `system` + `prompt`) is required because cache markers ride along on a message's `providerOptions`. The system breakpoint is sticky; the rolling-tail breakpoint is added per-step inside `withAnthropicCache` (`agent/prepare-step-cache.ts`). Non-Anthropic models silently ignore the marker, so the dedup-only path is used for them.

### Stopping strategy

The main exercise of the architecture. Three limiters at once:

1. **Hard cap on steps.** `stopWhen: stepCountIs(8)` — stubborn ceiling. Most tasks need 4-6 steps; 8 is for complex ones.

2. **Tool deduplication via `prepareStep`.** If the last 2 steps called the same tool with the same key arguments — the next call is rejected. Places a reminder in context: "you already called X with these args; consider summarizing or using a different tool."

```ts
// tools/__helpers__/dedup.ts
import type { PrepareStepFunction } from 'ai';
import type { Tools } from '@/tools/registry';

export const dedupRecentToolCalls: PrepareStepFunction<Tools> = ({ steps, messages }) => {
  if (steps.length < 2) return undefined;
  const last = firstStaticCall(steps.at(-1)!);
  const prev = firstStaticCall(steps.at(-2)!);
  if (!last || !prev) return undefined;
  if (last.name !== prev.name || last.argsKey !== prev.argsKey) return undefined;
  const alreadyWarned = messages.some(
    (m) => m.role === 'system' && typeof m.content === 'string' &&
           m.content.startsWith(REMINDER_PREFIX),
  );
  if (alreadyWarned) return undefined;
  return { messages: [...messages, { role: 'system', content: buildDedupReminder(last.name) }] };
};
```

Composed with `withAnthropicCache` for Sonnet, so the injected reminder also rides into the cached tail on the next step.

3. **Token budget cap.** In `onStepFinish` track `cumulativeTokens`. If it crosses `TOKEN_BUDGET` (50K) — log a warning, but let the agent finish the step (a hard interrupt risks inconsistent state). One-shot warn per run to avoid log spam.

---

## Final output via post-parse `extractCard` + Zod

```ts
// schemas/v1/triage-card.ts
import { z } from 'zod';

export const SCHEMA_VERSION = 'v1.0.0' as const;

export const TriageCard = z.object({
  category: z.enum([
    'bug', 'feature', 'docs', 'question',
    'duplicate', 'wontfix', 'invalid', 'other',
  ]),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  suspectedFiles: z
    .array(
      z.object({
        path: z.string(),
        rationale: z.string().min(10),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .max(5),
  similarIssues: z
    .array(
      z.object({
        number: z.number().int().positive(),
        title: z.string(),
        relevance: z.enum(['exact_duplicate', 'closely_related', 'tangentially_related']),
      })
    )
    .max(5),
  draftResponse: z.string().min(20).max(1500),
  reasoning: z.string().min(20).describe(
    'Brief summary of the investigation: which steps led where.'
  ),
});

export type TriageCard = z.infer<typeof TriageCard>;
```

The agent emits the final TriageCard as a raw JSON object in its last assistant message (the system prompt forbids markdown fences, but the extractor handles them anyway). `extractCard()` in `agent/run.ts` strips optional ```json fences, slices from the first `{` to the last `}`, runs `JSON.parse`, then `TriageCard.safeParse`. If the result is `null` (cap-hit, malformed JSON), `runTriageOnce` walks `allStepTexts` in reverse to recover a `TriageCard` from an earlier intermediate step — this saves roughly 5–10% of completeness on cap-hit runs.

Why not `experimental_output` / structured outputs? Two reasons:
1. **Provider portability.** Each provider exposes structured output differently; the AI SDK v6 wrapper is uneven across Anthropic/OpenAI/Google. Post-parse works the same for all four models we test.
2. **Cap-hit recovery.** When the model fills 8 steps with tool calls and never emits a final structured block, the JSON it scribbled in step 6 or 7 is still recoverable via `extractCard`. A structured-output contract would have nothing to fall back to.

---

## Eval rubric

Per-issue scoring:

| Metric | What we measure | Formula |
|---------|-----------|---------|
| Category accuracy | category exact match | 1.0 / 0.0 |
| File recall | fraction of changed-in-fix-PR files identified | `\|suspectedFiles ∩ groundTruthFiles\| / \|groundTruthFiles\|` |
| File precision | fraction of suspectedFiles that were actually changed | `\|suspectedFiles ∩ groundTruthFiles\| / \|suspectedFiles\|` |
| Similar issue recall | fraction of human-mentioned similar issues found | Jaccard on numbers |
| Trajectory length | actual steps used | smaller better; reported, not scored |
| Tool sequence sanity | did agent call duplicate-arg tools? | binary; penalty if >0 |
| Final completeness | did `extractCard` produce a TriageCard that passes `TriageCard.safeParse`? | binary |

**Aggregate score** per issue: `0.4 × categoryAccuracy + 0.3 × fileF1 + 0.2 × similarIssueRecall + 0.1 × completeness`. Weights are pinned in `evals/README.md`; changing them — bump the eval version.

`evals/results.json`:

```json
[
  {
    "runId": "2026-05-09T14:00:00Z",
    "schemaVersion": "v1.0.0",
    "promptVersion": "v1.0.0",
    "model": "claude-sonnet-4-6",
    "perIssue": [
      {
        "issueRef": "shadcn-ui/ui#4123",
        "categoryActual": "bug",
        "categoryExpected": "bug",
        "fileRecall": 0.66,
        "filePrecision": 1.0,
        "fileF1": 0.80,
        "similarIssueRecall": 1.0,
        "trajectoryLength": 5,
        "duplicateToolCalls": 0,
        "completeness": 1.0,
        "aggregate": 0.86
      }
    ],
    "aggregate": {
      "categoryAccuracy": 0.88,
      "fileRecall": 0.62,
      "filePrecision": 0.71,
      "fileF1": 0.66,
      "similarIssueRecall": 0.55,
      "averageTrajectoryLength": 5.2,
      "duplicateCallRate": 0.04,
      "completeness": 1.0,
      "weightedAggregate": 0.74
    }
  }
]
```

---

## Observability

`logs/steps.sqlite`:

```sql
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_idx INTEGER NOT NULL,
  ts TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  tool_name TEXT,                    -- NULL on final step
  tool_args TEXT,                    -- JSON
  tool_result_size INTEGER,          -- bytes
  tool_result_summary TEXT,          -- first 200 chars
  step_text TEXT,                    -- model's reasoning text in this step
  finish_reason TEXT,                -- 'tool-calls' | 'stop' | 'length'
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL
);

CREATE INDEX idx_steps_run ON steps(run_id);
CREATE INDEX idx_steps_tool ON steps(tool_name);
```

What a reviewer will see from these logs:
- **Trajectory shape distribution.** Which tools get called most often, which never. Sanity check on tool design.
- **Loop detection.** `SELECT run_id, COUNT(*) FROM steps WHERE tool_name = lag_tool GROUP BY run_id HAVING COUNT(*) > 0;` — where the agent loops.
- **Latency per tool.** The slowest tool — usually `search_code`; useful to know.
- **Cost per run.** `SUM(tokens_in × $/M) + SUM(tokens_out × $/M)` per run, aggregated.

`runs/{run_id}.json` — full run for replay:

```json
{
  "runId": "...",
  "issueUrl": "...",
  "ts": "...",
  "model": "claude-sonnet-4-6",
  "promptVersion": "v1.0.0",
  "steps": [
    { "idx": 0, "toolCalls": [...], "toolResults": [...], "stepText": "..." },
    ...
  ],
  "finalCard": { /* TriageCard */ },
  "totalTokens": ...,
  "totalLatencyMs": ...
}
```

Useful for re-reasoning without re-running the model.

### Langfuse tracing (OpenTelemetry)

The SQLite log is local and queryable; Langfuse adds a hosted, visual trace of every run with token cost and latency built in. The two run side by side — neither replaces the other.

- **Bootstrap.** `instrumentation.ts` registers a `NodeTracerProvider` with `LangfuseSpanProcessor` (Node runtime only — the Edge runtime is skipped). Next.js loads this file automatically on server startup.
- **Span emission.** Both `runTriage` (stream) and `runTriageOnce` (eval) pass `experimental_telemetry` to the AI SDK, so each LLM step and tool call becomes a span. `functionId` (`triage-stream` / `triage-once`) names the trace; `metadata` carries `runId` and model.
- **Trace grouping.** The AI SDK call is wrapped in `propagateAttributes({ sessionId, tags })` (`agent/run.ts`). `sessionId` is derived from the issue URL (`owner/repo#number`), so re-triages of the same issue group together; `tags` carry the model for slicing. Propagated attributes are captured at span start and inherited by every child span.
- **Flushing.** Spans buffer in-process, so they must be flushed before the function freezes or the process exits. The serverless route flushes via `after(() => langfuseSpanProcessor.forceFlush())`; the eval CLI (which never goes through Next.js) bootstraps its own provider in `evals/telemetry.ts` and flushes in `harness.ts`.
- **No keys, no problem.** With `LANGFUSE_*` env vars unset, spans are still created but nothing is exported — the app and evals behave exactly as before.

---

## Architectural decisions

Four decisions with rationale and cost are written up in [DECISIONS.md](./DECISIONS.md):

1. Six medium-grain tools, not one omnibus or fifteen micro-tools.
2. `stopWhen: stepCountIs(8)` *and* `prepareStep` dedup, not either alone.
3. Read-only tool surface, not mutating triage actions.
4. AI Gateway for Anthropic + OpenAI, direct SDK for Google, ephemeral prompt caching only on Sonnet.
