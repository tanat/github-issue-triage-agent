# Agent loop: streamText + tools + stopWhen + prepareStep

## Why you should understand the loop, not just call the SDK

Vercel AI SDK v6 gives you `streamText`, and in the simple case you can avoid thinking about what's happening inside. You passed tools, passed `stopWhen`, got a token stream — it works.

That's a bad strategy, because:

- when the agent loops, you don't understand where exactly;
- when cost rises, you don't know which step the leak is in;
- when the model "forgets" to call a tool, you don't see what was shown to it at that step.

`streamText` is a **wrapper around a loop**. If you understand the loop, you can tune it. If you don't — you pray.

> The AI SDK formalizes the contract through `stopWhen` and `prepareStep` ([Vercel docs](https://ai-sdk.dev/docs/agents/loop-control)). LangChain and Mastra use a similar model.

---

## Lifecycle of one run

Take `agent/run.ts:78`:

```ts
const stream = streamText({
  model: modelFor(modelKey),
  messages: initialMessages,
  tools,
  stopWhen: stepCountIs(STEP_HARD_CAP),
  prepareStep: isAnthropic
    ? withAnthropicCache(dedupRecentToolCalls)
    : dedupRecentToolCalls,
  onStepFinish: ({ toolCalls, toolResults, usage, finishReason, text }) => { ... },
});
```

What happens under the hood, step by step:

1. The SDK takes `initialMessages` (system + user).
2. **Before step 1** it calls `prepareStep({ steps: [], messages })`. May return `{ messages }` with modifications. In our case `dedupRecentToolCalls` at 0 steps returns `undefined` (nothing to dedup); `withAnthropicCache` puts a cache breakpoint on the user message.
3. The SDK sends the request to the LLM. The model responds with either a tool_call or text.
4. If tool_call: the SDK finds the corresponding `tool.execute()`, calls it, gets the result, appends tool_call and tool_result into messages.
5. **After the step** it calls `onStepFinish({ toolCalls, toolResults, usage, finishReason, text })`. In our case that's `logStep` into SQLite.
6. Checks `stopWhen(steps)`. If `true` — stop. If `false` — go to the next step.
7. **Before step 2** again `prepareStep` with accumulated `steps` and `messages`. If the last 2 steps are the same tool_call with the same arguments, a reminder is injected. The cache marker is moved to the new last message.
8. And so on until either the model responds with text without a tool_call (natural finale, `finishReason: 'stop'`), or `stopWhen` returns `true` (`finishReason: 'tool-calls'` or similar).

The model's final text lives in `result.text` (for `generateText`) or is assembled from the stream (for `streamText`).

---

## Detail: `messages` and how they grow

After the initial messages (system + user), each step appends to the array:

- an assistant message with `tool_calls`;
- a tool message with `tool_results`.

If the model produced an intermediate text response — it is appended too. This matters because:

- **input tokens grow linearly** with the number of steps;
- **prompt caching** lets you avoid paying for this growing tail, if you cache before each step.

In our code `withAnthropicCache` (`agent/prepare-step-cache.ts`) does exactly that:

```ts
return async (ctx) => {
  const innerResult = await inner(ctx);
  const baseMessages = (innerResult?.messages as ModelMessage[]) ?? ctx.messages;
  if (baseMessages.length === 0) return innerResult;
  const lastIdx = baseMessages.length - 1;
  const cloned = baseMessages.map((m, i) => {
    if (i !== lastIdx) return m;
    return {
      ...m,
      providerOptions: {
        ...(m.providerOptions ?? {}),
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    } as ModelMessage;
  });
  return { ...(innerResult ?? {}), messages: cloned };
};
```

What's happening here and why:

- **`inner` is wrapped** — this is a composition: dedup does its work first, then we add the cache. If it were the other way around, dedup could cut out the cached tail and bust the cache.
- **We clone the message, don't mutate it.** The SDK holds a reference to the original array; if we attach `providerOptions` to the original, the marker will leak into the following steps and may cause [double caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
- **Marker on the last message.** Anthropic caches the prefix up to and including the breakpoint. On each step the "last message" is a new tool_result, and the cache cap moves. The old cache is reused (cache-hit on the prefix), the new tail is appended.

The system prompt is additionally marked in the initial messages in `run.ts:67`:

```ts
{
  role: 'system',
  content: systemPrompt,
  ...(isAnthropic && {
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  }),
}
```

This is a static breakpoint that doesn't move between steps — the system prompt is cached once and reused on every step. Without this you'd pay for ~600 tokens of system prompt × 8 steps = 4800 tokens out of nowhere every run.

---

## Detail: `stopWhen`

```ts
stopWhen: stepCountIs(STEP_HARD_CAP), // STEP_HARD_CAP = 8
```

`stepCountIs(n)` returns `true` when `n` steps have been completed. The SDK checks this **after** every step.

In the docs you also see the name `isStepCount` ([AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)) — it's a synonym. In the project code `stepCountIs` is used. Both are valid.

The SDK default is `stepCountIs(20)`. That's too many for most tasks:

- 20 steps × 8K average input × Sonnet 4.6 = ~$0.05 worst case per run;
- 20 steps × 4 seconds = 80 seconds of latency;
- by step 15 the model most likely no longer has a chance to produce a meaningful result.

We use 8 — that's **2× the typical route**. The typical route on our fixtures: `get_issue → search_issues → search_code → read_file → final` = 4–5 steps. Double it — get a buffer for spare moves, and write in the prompt "aim for 4–6 tool calls. Hard cap is 8".

Why `stopWhen` rather than a max in the prompt itself? Because the model **may not obey** the prompt. `stopWhen` is a **hardware** barrier. Without it one or two percent of runs fly off into the far tail and devour the budget.

More on the combination of `stopWhen` + dedup — in `04-stopping-conditions.md`.

---

## Detail: `prepareStep`

`prepareStep` is a hook called **before every step**. Signature:

```ts
type PrepareStepFunction<TOOLS> = (ctx: {
  steps: StepResult<TOOLS>[];
  stepNumber: number;
  messages: ModelMessage[];
  // ...
}) => PromiseLike<{ messages?: ModelMessage[]; ... } | void>;
```

What you can do inside it:

- modify `messages` — add system hints, trim history, place cache markers;
- swap `model` or `tools` for a specific step;
- stop early by returning a special object.

We solve two tasks here through composition of two `prepareStep` functions.

**Inner** — `dedupRecentToolCalls` (`tools/__helpers__/dedup.ts`):

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

Logic:

1. If fewer than 2 steps — do nothing.
2. Take the first tool_call of the last and second-to-last step (compare name and stable-stringified args).
3. If they're identical — add a system message "you repeated yourself, stop".
4. If such a message is already added — don't pile up duplicates.

**Outer** — `withAnthropicCache` — wraps dedup and on top of its result slaps a cache marker.

Composition matters: dedup modifies `messages` (adds the reminder), the cache takes **dedup's result** and places the marker on the final last message. If the last message now contains the reminder — it enters the cached prefix, and on the next step it already works with a cache-hit.

---

## `onStepFinish` — what's inside

From `agent/run.ts:86`:

```ts
onStepFinish: ({ toolCalls, toolResults, usage, finishReason, text }) => {
  const now = Date.now();
  const latencyMs = now - stepStartedAt;
  stepStartedAt = now;
  const firstCall = toolCalls?.[0];
  const firstResult = toolResults?.[0];
  const tokensIn = usage?.inputTokens ?? 0;
  const tokensOut = usage?.outputTokens ?? 0;
  cumulativeTokens += tokensIn + tokensOut;
  if (!budgetWarned && cumulativeTokens > TOKEN_BUDGET) {
    budgetWarned = true;
    console.warn(`[run ${runId}] token budget exceeded: ...`);
  }
  logStep({ runId, stepIdx, model: modelId, toolName: firstCall?.toolName ?? null,
            toolArgs: firstCall?.input, toolResult: firstResult?.output,
            stepText: text || null, finishReason: finishReason ?? null,
            tokensIn, tokensOut, latencyMs });
  stepIdx += 1;
}
```

What's important to notice here:

- **`firstCall`, not all of them**: the model *may* call multiple tools in parallel in one step. With us Sonnet 4.6 almost always makes one tool_call per step (the prompt is set up that way and `temperature` is low), and we log the first. If you build an agent with parallel tools — rewrite as an array.
- **`latencyMs` is counted between steps**, not on the tool_call itself. This gives an honest "time from end of previous step to end of this", including both LLM time and tool-execute time.
- **`tokensIn` of each step is cumulative input** (the whole history), not a delta. This is also why prompt caching is critical — otherwise you pay for the same prefix N times.
- **`budgetWarned` fires once**. Subsequent steps don't repeat the warning. The goal is not to spam the log, but to mark the run as suspicious for last-mile analytics.

---

## Stream vs generate: two modes

In `agent/run.ts` there are **two** entry points:

- `runTriage()` — `streamText`, for the UI (`app/api/triage/route.ts`);
- `runTriageOnce()` — `generateText`, for evals (`evals/harness.ts`).

Why two?

- **The UI wants streaming output.** It's important for the user to see something is happening. `streamText` emits partial tokens, tool-events, steps in real time.
- **The eval wants to wait.** The eval harness runs fixtures one after another and compares the final `TriageCard` to the reference. A stream isn't needed there and only complicates the code.

Both functions use identical loop configuration (`tools`, `stopWhen`, `prepareStep`, `onStepFinish`). This is critical — if eval behavior differs from the UI, you're measuring something other than what you ship. Any new parameter, add it to both functions at once.

---

## What to try by hand

1. Run `pnpm dev`, open the UI, paste a public issue URL. In the console you'll see `[run <uuid>]` logs on every step.
2. Change `STEP_HARD_CAP` to `2` and run again. The model won't manage to gather data — `extractCard()` will pull partial JSON from the last step_text or nothing. This simulates a cap-hit.
3. Remove `prepareStep` entirely. Run 5 fixtures through `pnpm eval`. Compare `duplicateCallRate` and `averageTrajectoryLength` before and after. The numbers in `evals/results.json` are your proof that dedup-defense works.
4. In `onStepFinish` add `console.log({ step: stepIdx, tokensIn, cumulativeTokens })`. See how cumulative tokens grow without cache and with cache (flip `isAnthropic` to `false` by hand).

Next — `03-tool-design.md`: why exactly 6 tools, how to phrase a description, how to count "the granularity right".
