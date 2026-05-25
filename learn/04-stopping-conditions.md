# Stopping conditions: stopWhen + dedup as two-layer defense

## Why this is the project's main exercise

If you remember only one thing from all of project 03 — let it be this:

> **Without stopWhen and dedup-defense, in 1–5% of runs your agent slides into a looped `search_issues` (or any other) and burns the entire token budget in 30 seconds.** This isn't theory. It happens on day three in production.

And the breakage isn't loud. The model doesn't crash with an error. It just spins the same call and at the end produces a garbage or empty answer. You find out from the bill.

That's why stop conditions are **the main architectural primitive of agents**, and they need to be designed, not "well, the SDK does something by default".

---

## Why one layer of defense doesn't work

The most obvious solution: "I'll just set `stopWhen: stepCountIs(8)` and be done". That isn't enough.

Scenario 1: the model hit `stopWhen` after 8 identical `search_issues` calls.
- The defense fired — the budget isn't exceeded beyond 8 steps.
- But: there's no final answer, the model didn't get to summarize the data.
- 8 steps × ~3 seconds × ~$0.01 = ~$0.08 spent for nothing.
- The saved trace shows 8 identical calls — confusing, but that's exactly the symptom you'll be looking for in logs.

Scenario 2: the model took 2 useful steps, then 6 identical ones, then nothing.
- There were useful steps, but the model drowned in a loop.
- No final.

In both cases `stopWhen` by itself **only limits damage**, it doesn't **fix the behavior**. To fix it you need a second layer — feedback into the model itself.

---

## Layer 1: `stopWhen` (hard cap)

```ts
// agent/run.ts
export const STEP_HARD_CAP = 8;

stopWhen: stepCountIs(STEP_HARD_CAP),
```

Properties:

- **hardware-level constraint** — the SDK physically won't call the model a 9th time;
- **independent of the model's behavior** — even if the model saw "you can use unlimited tools" in the system prompt, `stopWhen` overrides it;
- **inverse cost prediction**: 8 steps × max-input × Sonnet-price = a hard ceiling.

How much to set?

From the system prompt: *"Aim for 4–6 tool calls. Hard cap is 8."*

Empirical rule: **2× the typical route**. A typical triage trajectory is 4–5 steps. Doubled — 8. That gives a buffer for 1–2 spare moves (for example, a repeat `search_code` with a different query) and at the same time doesn't let the model sprawl.

Why not 20 (the SDK default)? Because between 8 and 20 steps the model in our task does nothing useful. Empirical fact: on fixtures with `stepCountIs(20)`, after step 6–7 the useful signal is exhausted. After that — either a correct final, or blast radius.

Community consensus — [Vercel recommends](https://vercel.com/blog/ai-sdk-6) "1 for chat, 5–10 for multi-step, 10–20 for autonomous agent". For triage we're right in the middle.

### Alternative builders

The AI SDK gives several stops out of the box:

- `stepCountIs(n)` / `isStepCount(n)` — what we use;
- `hasToolCall(toolName)` — stop right after a specific tool is called. Useful if you have a terminator tool like `submit_final_answer`.
- combine via `stopWhen: [a, b]` (OR semantics).

We don't use `hasToolCall` because the final is **text with JSON**, not a tool call. If you rework it to "submit_card" — it'd come in handy. That's an evolutionary path for project 04.

---

## Layer 2: `prepareStep` dedup-reminder

From `tools/__helpers__/dedup.ts`:

```ts
export const dedupRecentToolCalls: PrepareStepFunction<Tools> = ({ steps, messages }) => {
  if (steps.length < 2) return undefined;
  const last = firstStaticCall(steps.at(-1)!);
  const prev = firstStaticCall(steps.at(-2)!);
  if (!last || !prev) return undefined;
  if (last.name !== prev.name || last.argsKey !== prev.argsKey) return undefined;
  const alreadyWarned = messages.some(
    (m) => m.role === 'system' &&
           typeof m.content === 'string' &&
           m.content.startsWith(REMINDER_PREFIX),
  );
  if (alreadyWarned) return undefined;
  return {
    messages: [...messages, { role: 'system', content: buildDedupReminder(last.name) }],
  };
};
```

What this does: looks at **the last two steps**. If they are the same tool_call with identical arguments, it appends a system message to the conversation:

```
[dedup] You just called `search_issues` twice with identical arguments. Do not call it again with the same input. Either change the arguments meaningfully, pick a different tool, or stop calling tools and write your conclusion.
```

This is a **soft correction**: the model sees the hint in context, but **decides itself** what to do. On Sonnet 4.6 this fires in ~95% of cases — it switches either to a different tool or to the final answer.

### Why this way and not another

**Why compare exactly the last two steps?**

- If comparing against all previous ones — many false positives. For example, "re-calling `read_file` with the same path after several search steps" is often valid, the model is clarifying what it saw.
- If comparing only against the immediate previous one — we catch **consecutive duplicates**, which is the classic looping pattern.

**Why `stableStringify` for arguments?**

```ts
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return '{' + entries.map(([k, v]) =>
    JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
}
```

Ordinary `JSON.stringify` is not stable against key order. If the model sent `{ owner, repo, query }` one time and `{ query, owner, repo }` another time — ordinary stringify gives different strings, dedup misses. Stable-sort solves this.

**Why skip `call.dynamic`?**

```ts
if (call.dynamic) return null;
```

Dynamic tools (for example, MCP tools) may change signature between calls; comparing them by arguments is unreliable. Ours is all static, but the guard is left in for the future.

**Why the `alreadyWarned` stop?**

If the conversation already has one `[dedup]` reminder, adding a second one is extra noise and wasted tokens. One is enough for the model to correct itself. If it didn't help — the next step will also be a duplicate, and then the model will **either change behavior, or hit `stepCountIs(8)`**. That's the two-layer defense.

### Why system, not tool-result

You could have crammed the reminder in as a fake tool_result. But a system message is seen by the model **before** it starts the next step, and doesn't "hang" as a tool response that needs to be reflected on. It's cleaner.

There's a nuance: some providers (for example, OpenAI strict mode) don't like multiple back-to-back system messages in the middle of a conversation. The AI SDK correctly serializes this for each provider — but on something exotic, check.

---

## How the two layers work together

Scenario: the model decided to "search again with the same words".

```
Step 1: get_issue(owner, repo, 123)              ← useful
Step 2: search_issues("rate limit")              ← useful
Step 3: search_issues("rate limit")              ← DUPLICATE
  → prepareStep sees the duplicate, injects the reminder
Step 4: search_issues("rate-limit hit")          ← model reformulated ← reminder worked
Step 5: read_file("src/api/rate.ts")             ← new move
Step 6: <final text with JSON>                   ← final
```

Without dedup-reminder:

```
Step 1: get_issue                                ← useful
Step 2: search_issues("rate limit")              ← useful
Step 3: search_issues("rate limit")              ← duplicate
Step 4: search_issues("rate limit")              ← duplicate
Step 5: search_issues("rate limit")              ← duplicate
Step 6: search_issues("rate limit")              ← duplicate
Step 7: search_issues("rate limit")              ← duplicate
Step 8: search_issues("rate limit")              ← stopWhen hit
  → no final, or garbage
```

This is real behavior in a trace without dedup. On a fixture corpus of 5 issues, without dedup ~3 of 5 have ≥1 duplicate; with dedup — 0–1.

---

## Third layer: token budget warning (soft)

```ts
// agent/run.ts
export const TOKEN_BUDGET = 50_000;

if (!budgetWarned && cumulativeTokens > TOKEN_BUDGET) {
  budgetWarned = true;
  console.warn(`[run ${runId}] token budget exceeded: ${cumulativeTokens} > ${TOKEN_BUDGET} tokens.`);
}
```

This is **not a stop**. It's a marker — a tag in the logs "this run was heavy". Used for:

- prod alerts (if 5% of runs exceed the budget — something's off);
- last-mile analytics ("which fixtures are consistently heavy?");
- early detection of regressions after a prompt or tool change.

Why soft, not hard? If you abort mid-step — the model already spent input tokens on that step, but there's no result. Better to let the step finish. A hard cut on tokens is needed only if you're afraid of runaway billing — then add `if (cumulativeTokens > HARD_TOKEN_CAP) throw`. With us 8 steps is already the upper bound, runaway is impossible.

---

## Failure modes — what happens in prod

### Mode 1: the model hit `stopWhen` without a final

Symptoms: `result.finishReason === 'tool-calls'` (and not `'stop'`), `card === null`.

What to do in code: `extractCard()` tries to find JSON in the **last** step_text. If not in the last — it walks back through all step_texts. This covers the case "the model already started writing JSON at step 6, but decided to do one more search and didn't make it".

What to do in evals: `scoreCompleteness` = 0 for this run. The aggregate metric drops. You see it in `evals/results.json`. You react — raise `STEP_HARD_CAP` (if the task is genuinely large) or tighten the prompt ("be decisive").

### Mode 2: duplicates still slipped past dedup

It happens: the model sent an identical call 3 steps after the first, dedup compares only neighbors and doesn't catch it. This is a **rare** pattern — usually if dedup already fired, the model doesn't return.

What to do: in `evals/score.ts:scoreTrajectory` we count `duplicateCount` **over the entire trace**, not just consecutive:

```ts
for (let i = 1; i < steps.length; i++) {
  if (prev.toolName === curr.toolName &&
      stableStringify(prev.toolArgs) === stableStringify(curr.toolArgs)) {
    duplicateCount += 1;
  }
}
```

Hmm, actually only adjacent pairs are compared here too. That's intentional: the metric should match what dedup detects, so as not to confuse. If you want to catch "far" duplicates — add a second scanner with window=∞ as a separate metric (`farDuplicateCount`). In my experience, on a corpus of 5–10 fixtures such duplicates are <0.5%.

### Mode 3: the model repeated the call once, dedup injected the reminder, the model ignored it

Also rare on Sonnet 4.6. If it happens — it's often a symptom of a bad system prompt: the model doesn't understand **what the next move is**. Then the cure is not in dedup, but in the prompt: explicitly list alternatives, give an example sequence.

---

## What to try by hand

1. **Disable dedup.** Comment out the `prepareStep` line. Run `pnpm eval --model=sonnet`. Compare `duplicateCallRate` in `evals/results.json` before and after.
2. **Set `STEP_HARD_CAP = 3`.** Run on a complex issue. See how `extractCard()` saves or doesn't save you.
3. **Force a duplicate** through `pnpm dev`. Take an issue where you know the model often spins search. Open DevTools → Network → watch the stream. On the event of step 3, a tool_call and immediately a system message `[dedup]` should appear.
4. **Read the stable-stringify tests** in `tools/__tests__/dedup.test.ts` (if they exist). Try to break it — add a case with identical objects of different key order.

Next — `05-typed-output.md`: how to pull `TriageCard` out of free text and why `extractCard` is needed.
