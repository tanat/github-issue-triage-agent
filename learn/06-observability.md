# Observability: SQLite step log + inspect-trace

## Why you need proper observability

In one-shot you debugged like this: input → output → "ah, the model said crap" → tweak the prompt. One glance.

In an agent that loop doesn't work. To understand **why** the model produced a bad `TriageCard`, you need to see 5–8 steps of its "thinking": what it requested, what it got, how it transitioned. Without this you debug the prompt blindly.

And this isn't about "pretty dashboards". It's about **the basic ability to actually fix the agent** when it consistently fails on some type of issue.

> Paid observability (LangSmith, Helicone, Phoenix) is the standard for prod agents. For a learning project, SQLite + CLI is enough and gives you full understanding of what you'd automate in the paid solution.

---

## What we log

Each agent step → one row in `logs/steps.sqlite`. Schema from `agent/log.ts:34`:

```sql
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_idx INTEGER NOT NULL,
  ts TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  tool_name TEXT,
  tool_args TEXT,
  tool_result_size INTEGER,
  tool_result_summary TEXT,
  step_text TEXT,
  finish_reason TEXT,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id);
CREATE INDEX IF NOT EXISTS idx_steps_tool ON steps(tool_name);
```

Why these fields exactly — let's go through it.

### `run_id` + `step_idx` — unique step addressing

One run = N steps = N rows with the same `run_id`. This lets you JOIN runs with eval results (by `runId`) and at the same time filter "only steps with tool_name = 'search_issues'".

### `ts` — insert timestamp, not step time

```ts
new Date().toISOString()
```

This is needed for **time-based analytics** ("regression after May 17?"), not for time-of-flight (that's counted through `latencyMs` separately).

### `schema_version` + `prompt_version` — versioning

```ts
import { PROMPT_VERSION } from './system-prompt';
export const SCHEMA_VERSION = 'v1.0.0';
```

Without this, a month from now you'll have steps with different prompts and different schemas in the table, and aggregate metrics become meaningless. Versions let you filter "only runs on the current prompt version" so you compare apples to apples.

The `PROMPT_VERSION` string lives right in `agent/system-prompt.ts`. When you change the prompt — bumping the version is **mandatory**, otherwise you lose cross-comparability.

### `model` — which model ran it

`'claude-sonnet-4-6'`, `'gpt-4o'`, `'gemini-2.5-flash'`, `'gemini-2.5-pro'`. This lets you keep trajectories of all models in one table and compare "Sonnet vs GPT-4o on our corpus".

### `tool_name`, `tool_args`, `tool_result_*` — the substance of the step

```ts
const argsJson = entry.toolArgs ? JSON.stringify(entry.toolArgs) : null;
const resultJson = entry.toolResult !== undefined ? JSON.stringify(entry.toolResult) : null;
const summary = resultJson === null ? null : resultJson.slice(0, 200);
```

What's stored:

- `tool_name`: tool name or `NULL` for a final text step.
- `tool_args`: full JSON input (usually <500 bytes).
- `tool_result_size`: byte length of the JSON result. **Not the result itself in full** — it can be enormous (issue body + 50 comments = 30K).
- `tool_result_summary`: the first 200 bytes. Enough for "oh, it's an empty array" / "an error" / "the first fields of the result".

Why not store the full `tool_result`?

- The SQLite file balloons (1MB per run × 100 runs = 100MB);
- grepping BLOBs is slow;
- the full result is in `runs/*.json` anyway (one per run) and in the LLM provider's logs (Anthropic console).

If you **really** need the full one — add a field `tool_result_full TEXT` and write into it alongside the summary. I'd rather go to the Anthropic console instead — the full conversation is there already.

### `step_text` — the model's text on this step

If the model wrote intermediate thoughts **between tool_calls**, they're here. This is rare but useful — sometimes you see "I have a hypothesis X, I'll check via `read_file`", and that explains the next tool_call.

### `finish_reason` — why the step ended

Values: `'stop'` (the model wrote a final on its own), `'tool-calls'` (ended with a tool_call, the loop continues or hit `stopWhen`), `'length'` (exceeded the provider's max-tokens). Analytics "how many runs hit `stopWhen`" = `finish_reason = 'tool-calls'` on the last step.

### `tokens_in`, `tokens_out`, `latency_ms` — cost and speed

`tokens_in` for each step is **cumulative input** (everything the model sees, including historical tool_results). Summing across steps gives a rough estimate of **total cost** (accounting for the fact that without cache the prefix is recomputed).

`latency_ms` — time between the end of the previous step and the end of this one. Includes LLM latency + tool-execute latency.

With this trio you can do:

```sql
SELECT tool_name, AVG(latency_ms), AVG(tokens_in)
FROM steps
WHERE run_id IN (SELECT run_id FROM steps WHERE prompt_version = 'v1.0.0')
GROUP BY tool_name;
```

And see which tool is the most expensive / slow.

---

## Where it lives and when it's disabled

```ts
const DB_PATH = path.join(process.cwd(), 'logs', 'steps.sqlite');

function isWritable(): boolean {
  return !process.env.VERCEL;
}

function db(): Database.Database | null {
  if (!isWritable()) return null;
  ...
}
```

The file lives in `logs/steps.sqlite`. WAL mode — for concurrent reads without locking (you can open it in DBeaver while the agent writes).

The `VERCEL` env var disables writing — on serverless you have no filesystem for write operations (technically there's `/tmp`, but it's ephemeral). In prod you replace this with Postgres or managed observability. With us, for learning — local SQLite.

---

## `inspect-trace.ts` — CLI for a single run

From `scripts/inspect-trace.ts`:

```ts
const rows = getStepsByRun(runId);
console.log(`Run ${runId} — ${rows.length} step(s)`);
for (const row of rows) {
  const header = `[step ${row.step_idx}] ${row.tool_name ?? '(no tool — final)'} ` +
    `· ${row.latency_ms}ms · in=${row.tokens_in} out=${row.tokens_out}` +
    (row.finish_reason ? ` · finish=${row.finish_reason}` : '');
  console.log(header);
  if (row.tool_args) console.log(`  args: ${row.tool_args}`);
  if (row.tool_result_summary) {
    console.log(`  result[${row.tool_result_size ?? 0}b]: ${row.tool_result_summary}`);
  }
  if (row.step_text) {
    const shortened = row.step_text.length > 400
      ? row.step_text.slice(0, 400) + '…'
      : row.step_text;
    console.log(`  text: ${shortened.replace(/\n/g, '\n        ')}`);
  }
}
```

Invocation:

```bash
pnpm tsx scripts/inspect-trace.ts <runId>
```

What you'll see — a typical triage trace:

```
[step 0] get_issue · 1240ms · in=850 out=120
  args: {"owner":"facebook","repo":"react","number":12345}
  result[3402b]: {"number":12345,"title":"Rendering bug...","state":"open",...

[step 1] search_issues · 1850ms · in=4200 out=80
  args: {"owner":"facebook","repo":"react","query":"hydration error rendering"}
  result[1240b]: [{"number":12111,"title":"Hydration mismatch on..."},...

[step 2] read_file · 2100ms · in=5400 out=110
  args: {"owner":"facebook","repo":"react","path":"packages/react-dom/src/client/ReactDOM.js"}
  result[8200b]: {"path":"packages/react-dom/src/client/ReactDOM.js","size":...

[step 3] (no tool — final) · 3200ms · in=14000 out=850 · finish=stop
  text: {
          "category": "bug",
          "severity": "high",
          ...
```

This is your main trajectory debugging tool.

---

## What to look for in a trace when debugging an error

### "No final arrived" (`card === null`)

Look at the last step:

- `tool_name` exists, `finish_reason = 'tool-calls'` → cap-hit. Solution: `STEP_HARD_CAP` ↑, or shorten tool_results (the model drowns in context), or tighten the prompt.
- `tool_name == null`, `step_text` exists, but `extractCard` returned `null` → invalid JSON. Copy `step_text` and run it through `TriageCard.safeParse()` by hand. You'll see which field broke.

### "A duplicate slipped through"

```bash
sqlite3 logs/steps.sqlite \
  "SELECT step_idx, tool_name, tool_args FROM steps WHERE run_id = '<id>' ORDER BY step_idx;"
```

If two tool_args in a row are identical — that's exactly the case dedup didn't catch. Most often that means `stableStringify` gave different strings on semantically identical arguments (e.g. `null` vs `undefined`).

### "Too slow"

```sql
SELECT step_idx, tool_name, latency_ms FROM steps WHERE run_id = '<id>';
```

If one step took >5 seconds:

- `search_code` — the GitHub API is globally slow, especially on big repos;
- `read_file` — may be a huge file (`tool_result_size > 50000`);
- a step without a tool — the LLM thought for a long time, usually when the context ballooned >30K.

### "Expensive"

```sql
SELECT SUM(tokens_in + tokens_out) FROM steps WHERE run_id = '<id>';
```

Compare with `TOKEN_BUDGET = 50_000`. If it's close — look at which step ate the most tokens. Usually that's the step right after a big `read_file` or after several comments in `get_issue`.

---

## `runs/*.json` — a parallel log

Besides SQLite, the eval harness writes `runs/<runId>.json` with the full run result:

```ts
{
  runId, model, finishReason,
  card: TriageCard | null,
  steps: TrajectoryStep[],
  totalTokens, totalLatencyMs
}
```

Why duplicate SQLite? Because SQLite stores a truncated result-summary (200 bytes), but `runs/*.json` holds the **full** `TriageCard` you can diff between eval runs. It's a `git-diff-able` artifact.

---

## Production observability

When you go to prod, replace SQLite with:

- **Postgres** or **ClickHouse** for the central store — the same fields, indexes on `run_id`, `tool_name`, `ts`.
- **OpenTelemetry traces** — each step as a span, parent — the request span. The AI SDK exports [OTel spans automatically](https://ai-sdk.dev/docs/agents/loop-control), you only need to hook up an exporter.
- **LangSmith / Helicone / Phoenix** — managed solutions with UI. Cost money, but give grouping, diffs, search out of the box.

The principle is the same: one row per step, prompt/schema versioning, aggregation by runId.

---

## What to try

1. Run `pnpm dev`, do 3 triages on different issues. Then:

   ```bash
   sqlite3 logs/steps.sqlite \
     "SELECT run_id, COUNT(*), SUM(latency_ms)
      FROM steps GROUP BY run_id ORDER BY MIN(ts) DESC LIMIT 10;"
   ```

   You'll see how many steps and total latency each run had.

2. Take one runId and run `pnpm tsx scripts/inspect-trace.ts <id>`. Compare visually with what you saw in the UI.

3. Drop garbage into the system prompt ("ALWAYS call search_code FIRST"). Run it. Look in the trace at which tool comes first. This will give you a feel that the system prompt is the actual first signal.

4. Add a `cache_read_input_tokens` field to `LogStepEntry`. Anthropic returns this in `usage` (`usage.cachedInputTokens` or similar). Log it, and after several runs look at the cache-hit-rate. This will give you concrete proof that prompt caching works.

Next — `07-evals.md`: agent metrics, the harness, and why eval is about process, not just result.
