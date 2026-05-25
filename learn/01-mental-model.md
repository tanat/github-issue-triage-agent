# Mental model: agent vs one-shot

## Why this shift is the most painful

When you write `generateText({ prompt })` or `streamObject({ schema })`, you have a simple picture in your head: a **function**. Input → one LLM call → output. If something went wrong, you look at the input and the output. That's it.

An agent is a **loop**. The model looks at the current state, picks an action (a tool call or a final answer), observes the result, updates its representation, picks the next action. This is a **REPL**, and you're not the one sitting inside — the LLM is.

And from this almost everything that breaks follows:

- you no longer control **how many times** the model will be called;
- you don't control **in what order** tools will be called;
- you don't control **when** the loop stops — the model decides (unless you put up a barrier);
- cost and latency are now **not a constant** but a long-tailed distribution.

If you used to debug prompt-engineering, you're now debugging **trajectory-engineering** — a sequence of steps.

---

## Side-by-side comparison

### One-shot (project 02)

```ts
const { object } = await generateObject({
  model: gateway('anthropic/claude-sonnet-4-6'),
  schema: SymptomIntake,
  prompt: userText,
});
```

- 1 LLM request.
- Cost is deterministic (priced by input/output tokens).
- Latency ~3–6 seconds for Sonnet 4.6.
- If no result comes back — you know immediately.
- Provider-side decoding guarantees valid JSON under the schema.

### Agent (this project)

```ts
const stream = streamText({
  model: gateway('anthropic/claude-sonnet-4-6'),
  messages,
  tools,                            // 6 read-only tools
  stopWhen: stepCountIs(8),         // hard upper bound
  prepareStep: withAnthropicCache(  // dedup + prompt caching
    dedupRecentToolCalls
  ),
  onStepFinish: logStep,            // log every iteration
});
```

- N LLM requests (typically 4–6, potentially up to 8).
- Cost and latency — a distribution. Worst case ~2–3× more expensive than typical.
- The final result is text in which JSON still has to be **extracted** (`extractCard`).
- You may get no result at all — for example, if the model hits `stepCountIs` before producing the final answer.

[Vercel AI SDK](https://vercel.com/blog/ai-sdk-6) formally calls this pattern "loop control" and ships stop builders out of the box: `stepCountIs` / `isStepCount`, `hasToolCall`. Details in `02-agent-loop.md`.

---

## Why even need an agent

Ask yourself: can the task be solved in one request?

If you have all the context you need and a fixed set of operations — **don't use an agent**. `generateObject` with a good schema will be faster, cheaper, and more predictable.

An agent is justified when:

1. **The route depends on data you don't know in advance.** In our task an issue may be a bug — then it's useful to read the mentioned file; it may be a question — then files aren't needed, similar issues are; it may be a duplicate — then `search_issues` is enough. You can't decide this ahead of time.
2. **The context is too large to stuff into one prompt.** You can't preload the entire repo. The model itself decides what to pull in.
3. **The cost of "do everything at once" is worse than "do selectively".** Reading all 200 files for every issue is silly. Reading the 1–2 needed ones is fine.

If none of these conditions hold, don't breed agents. It's an expensive and fragile abstraction. The community consensus ([AI SDK deep dive](https://www.digitalapplied.com/blog/vercel-ai-sdk-6-deep-dive-features-tool-calls-2026)) is to start with `stopWhen: stepCountIs(1)` and raise it to `5–20` only when the task is truly autonomous.

---

## What changes in your head

### 1. You design not a prompt but an **action surface**

In one-shot you write: "describe symptoms by the schema". That's all.

In an agent you write:

- system prompt: goal + rules of the game + contract for the final answer;
- a set of tools: their names, descriptions, input schemas;
- stops and dedup: what counts as failure or looping;
- the final contract: what is expected in the last step.

Each of these pieces influences the trajectory. A tool description is not a comment, it's **part of the prompt** that will reach the model in the system message. Details in `03-tool-design.md` and `08-prompt-engineering.md`.

### 2. You no longer "see" one answer — you look at a trace

In one-shot debugging: looked at the input, looked at the output, got it.

In agent debugging: you looked at 5 steps in a row, saw that on step 3 the model repeated `search_issues` with the same arguments, got the same response, and… repeated again. Looping. This is only visible in a trace — so SQLite logging (`agent/log.ts`) is not "nice to have" but part of the architecture.

### 3. You plan budgets in advance

From `agent/run.ts`:

```ts
export const STEP_HARD_CAP = 8;
export const TOKEN_BUDGET = 50_000;
```

`STEP_HARD_CAP` is a hard stop via `stopWhen: stepCountIs(8)`. The model physically cannot take a 9th step.

`TOKEN_BUDGET` is a soft boundary. It doesn't stop, it **warns** via `console.warn`:

```ts
if (!budgetWarned && cumulativeTokens > TOKEN_BUDGET) {
  budgetWarned = true;
  console.warn(`[run ${runId}] token budget exceeded: ...`);
}
```

Why soft, not hard? Because aborting mid-flight is worse than letting the current step finish: the model has already spent input tokens on this step. Better to get a degraded but valid result than half a tool_call.

### 4. You think about the **process**, not just the result

One-shot eval: schema valid? category right? — done.

Agent eval: same thing plus **how many steps**, **were there duplicates**, **how close is the tool sequence to the reference one**. This lives in `evals/score.ts` — `scoreTrajectory()`:

```ts
export function scoreTrajectory(steps: TrajectoryStep[]): TrajectoryReport {
  const length = steps.length;
  let duplicateCount = 0;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    if (prev.toolName === curr.toolName &&
        stableStringify(prev.toolArgs) === stableStringify(curr.toolArgs)) {
      duplicateCount += 1;
    }
  }
  return { length, duplicateCount };
}
```

This is already mainstream — frameworks [TRACE](https://arxiv.org/html/2602.21230v1), LangSmith, Arize all measure trajectory explicitly. Without this you get an "illusion of competence": the model produced the right answer through 3 duplicates and 7 steps instead of 4. It works, but it's expensive and fragile.

---

## Where the mines are hidden

### Mine 1: the "final answer" didn't arrive

The model took 8 steps, hit `stopWhen`, the last step was a tool-call rather than a text response. Contract broken.

Defense: `extractCard()` in `agent/run.ts` looks for JSON not only in `result.text`, but also **backwards through all step_text** in reverse order:

```ts
let card: TriageCardType | null = extractCard(result.text ?? '');
if (!card) {
  for (let i = allStepTexts.length - 1; i >= 0; i--) {
    card = extractCard(allStepTexts[i]);
    if (card) break;
  }
}
```

This works because Sonnet 4.6 often writes intermediate thoughts with almost-finished JSON. Without this safety net, you lose ~10–15% of runs to cap-hits.

### Mine 2: the model repeats a call

Without dedup defense, Sonnet 4.6 (and any other model, honestly) will happily repeat `search_issues` with the same query 3 times in a row, hoping for a new result. This isn't a model bug, it's a property of the transformer: if nothing changed in the input, nothing new will appear in the output — and if you have `temperature > 0`, small noisy variations will appear, which the model will perceive as "a new plan".

Defense: `prepareStep: dedupRecentToolCalls` looks at the last 2 steps and, if they are identical, injects a system message "you just called X twice with the same arguments, stop". Works in ~95% of cases. Details in `04-stopping-conditions.md`.

### Mine 3: the context balloons

Each step adds tool_call + tool_result to the input messages. By step 6 a typical input is ~30K tokens, by step 8 — up to ~70K. Without prompt caching you pay the full price for this tail on every step.

Defense: `withAnthropicCache` in `agent/prepare-step-cache.ts` puts `cacheControl: { type: 'ephemeral' }` on the last message before each step. Anthropic caches everything up to and including the breakpoint; cache-read costs 0.1× of the input price ([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). On our corpus an eval-run drops from ~$7.65 to ~$1.50.

Anthropic has two TTLs for ephemeral: 5 minutes (default, write 1.25×) and 1 hour (write 2×). For agents within a single request, 5 minutes is more than enough — steps run within seconds of each other. The 1-hour one is needed if you process dozens of issues in a batch with one system prompt. We use the default 5-minute one.

---

## One practical piece of advice

Don't write an agent from scratch for an empty task. First solve it via `generateObject` with a big prompt — it'll hold up if the context fits. When you hit the ceiling (context doesn't fit, or external calls are needed), then add tools and `stopWhen`.

This matches Vercel's recommendation: "first 1 step, then 5, then 10–20". Not the other way around.

Next — `02-agent-loop.md`: we walk through `streamText` + `tools` + `stopWhen` + `prepareStep` line by line.
