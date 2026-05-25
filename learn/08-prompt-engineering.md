# Prompt engineering: the system prompt as code

## Why the prompt isn't a "comment" but an **executable specification**

In ordinary code you write a function that *does* something. In an agent you write a prompt that *defines what the model should do*. It's an executable artifact — a change in it directly changes behavior, like a change in code. And precisely for that reason the prompt has to live by the same rules:

- **versioned** (`PROMPT_VERSION` in `agent/system-prompt.ts`);
- **checked via evals** (see `07-evals.md`);
- **read next to the code**, not stored in Notion;
- **goes through code review**, like any PR.

If you treat the prompt as "I tweaked something here" without a commit and without evals — you don't have an agent, you have a prototype that happens to work.

> This is a general stance — [Anthropic's documentation](https://www.anthropic.com/news/claude-sonnet-4-6) explicitly pins down "prompt as code": tests, versioning, review. Sonnet 4.6 especially responds well to structured prompts with explicit sections and constraints.

---

## Our system prompt — line by line

From `agent/system-prompt.ts`:

```ts
export const PROMPT_VERSION = 'v1.0.0' as const;

export const systemPrompt = `You are a senior engineer triaging GitHub issues for an open-source project.

# Goal
Read the issue, optionally inspect related code or commit history, and produce a final TriageCard JSON object.

# Available tools (read-only)
- get_issue: fetch the issue body, labels, reactions, comments. ALWAYS start here.
- search_issues: find related/duplicate issues by keyword. Pass plain keywords; never include \`repo:\` or \`is:issue\` qualifiers — they are added internally.
- search_code: locate where a function, identifier, or string literal lives.
- read_file: read a specific file at a path (with optional ref). Use to confirm a hypothesis about a suspected file.
- list_directory: list directory contents; use to orient yourself.
- get_file_history: list recent commits touching a file with linked issue/PR refs extracted.

# Working rules
- Tools are read-only. You cannot post, label, or close — only investigate.
- Do not invent file paths, issue numbers, commit shas, or labels. Anything you cite must come from a tool result.
- Do not repeat a tool call with identical arguments. If the result wasn't useful, change the tool or the args.
- Be decisive. Aim for 4–6 tool calls. Hard cap is 8 steps.

# Final output — TriageCard
You must return a JSON object matching the TriageCard schema:
- \`category\`: one of bug | feature | docs | question | duplicate | wontfix | invalid | other.
- \`severity\` (optional): critical | high | medium | low — only set when \`category === "bug"\`.
- \`suspectedFiles\` (≤5): each item is { path, rationale, confidence }. \`path\` MUST be a path you observed via \`read_file\`, \`search_code\`, \`get_file_history\`, or \`list_directory\`. Do not guess.
- \`similarIssues\` (≤5): each is { number, title, relevance }. \`number\` MUST come from a \`search_issues\` result.
- \`draftResponse\`: 1–4 short paragraphs of a polite, professional comment a maintainer could post verbatim. Acknowledge the report, summarise what you understand, and either ask a focused clarifying question or share next steps.
- \`reasoning\`: 2–3 sentences summarising your investigation path.

If you found nothing concrete (e.g. issue is a question), still produce a valid TriageCard with empty arrays where appropriate and a draftResponse that asks for clarification or suggests next steps.

# Output format
When you have finished investigating with tools, output your final message as a single raw JSON object — no markdown fences, no prose. The object must match the TriageCard schema exactly.
`;
```

Now let's go through why each section is exactly this.

### Header: identity + goal

```
You are a senior engineer triaging GitHub issues for an open-source project.

# Goal
Read the issue, optionally inspect related code or commit history, and produce a final TriageCard JSON object.
```

**"Senior engineer"** — this is `role-priming`. The Sonnet 4.6 model (like its predecessors) responds to role-setting: style changes, caution with conclusions, the tone of the draft response. Without this you get the "AI assistant tone" — heaping helpful-overused-words.

**"Open-source project"** — context. It tells the model that the maintainer is not a support team and hints at a respectful, technically precise tone in `draftResponse`.

**Goal — one line.** If the goal balloons into 5 lines, the model starts mixing tasks. One goal, clearly stated.

### "Available tools" — duplicating instruction

The tools are also passed to the model through the AI SDK with their descriptions. Why duplicate them in the system prompt?

- **To give a general overview.** The tool descriptions the model sees as a list, without hierarchy. In the prompt we write the order: `get_issue` is tagged "ALWAYS start here", the rest — without a forced order.
- **To give instructions that are **specific to our scenario**, not to the tool in general.** `search_issues: ... never include repo: or is:issue qualifiers` — this is about **our** wrapper, not about GitHub's search language in general.
- **To repeat constraints.** "Read-only" duplicates part of "Working rules". Duplication here is a feature, not a bug: any channel may be missed, and having two is safer.

This is a **double channel**, and it costs more (~80 tokens in the system prompt), but those 80 tokens are cached (`cacheControl: ephemeral` on system) and paid once — by our math, 0.3 cents per run.

### "Working rules" — behavioral constants

```
- Tools are read-only. You cannot post, label, or close — only investigate.
- Do not invent file paths, issue numbers, commit shas, or labels. Anything you cite must come from a tool result.
- Do not repeat a tool call with identical arguments. If the result wasn't useful, change the tool or the args.
- Be decisive. Aim for 4–6 tool calls. Hard cap is 8 steps.
```

Each rule addresses a concrete class of errors:

1. **"Read-only"** — the model doesn't try "I'll add a label" in `draftResponse`.
2. **"Do not invent"** — anti-hallucination. Especially important for `path` and `number`, which get validated later.
3. **"Do not repeat"** — self-control, duplicating the `dedupRecentToolCalls` layer. If even one model in 100 runs sees this rule and doesn't make a duplicate — that's a win out of nothing.
4. **"Aim for 4–6 ... Hard cap is 8"** — self-control on length. If the model sees "you have 8 steps", it economizes. Without this it can sprawl.

Why do **negative** instructions work worse than positive ones, but we still use them? Because Sonnet 4.6 follows them well. For GPT-4o and weaker models it's better to reformulate as positive ("Change tool or arguments after a failed call") — but we optimize for Sonnet as primary.

### "Final output" — the schema contract in natural language

Although `TriageCard` is defined via Zod and validated in code, **the model sees the schema through the prompt**, not through the Zod object. So it's needed here in human form.

Notice the duplication:

- enum values of `category` — listed in full;
- `path MUST be a path you observed` — anti-hallucination repeated;
- `number MUST come from a search_issues result` — likewise.

This is **redundant on purpose**. Every field that's easy to hallucinate is marked with an explicit "MUST" and a source. Without this Sonnet 4.6 with ~5% probability will write in a plausible but invented issue number.

### "Empty arrays" — escape valve

```
If you found nothing concrete (e.g. issue is a question), still produce a valid TriageCard with empty arrays where appropriate
```

Without this the model in ambiguous cases **either hallucinates** to fill a field, **or refuses** to produce a final ("I cannot determine..."). Both bad.

This escape valve says: "empty is a valid answer". The model uses it in ~30% of our fixtures (question-issues, where `suspectedFiles = []`).

### "Output format" — the final instruction

```
When you have finished investigating with tools, output your final message as a single raw JSON object — no markdown fences, no prose.
```

This is the **last** thing the model sees. By the recency effect in LLMs, the latest instructions have slightly elevated weight.

Right here is the admission: Sonnet 4.6 still wraps in fences sometimes. So `extractCard` catches fenced JSON — the prompt instruction works in ~85% of cases, the fallback covers the remaining 15%. This is **layered defense in depth**, and it's justified.

---

## Versioning

```ts
export const PROMPT_VERSION = 'v1.0.0' as const;
```

Rule: **change the prompt — bump the version**. Any: typo fix = patch (`v1.0.1`), new rule = minor (`v1.1.0`), rewrote the schema contract = major (`v2.0.0`).

This is critical for evals: `evals/results.json` records `promptVersion` in every entry. Comparing runs with different versions is invalid. Without bumping, you lose the ability to explain "why did aggregate drop from 0.71 to 0.65 — is this noise or a regression after my edit?".

Convention (semver-like):

- **patch** — typo, formatting, must not change behavior → you can skip a full eval rerun, but it's recommended;
- **minor** — new rules, new tools mentioned → rerun mandatory;
- **major** — schema contract changed, rules fundamentally changed → rerun + fixture update if references depend on the old schema.

---

## Tool descriptions — second-class prompt

Prompt engineering **doesn't end** at the system prompt. Every `description` of a tool in `tools/*.ts` is also part of the prompt, and it reaches the model on every step.

Compare:

- **System prompt** is loaded once, cached, influences overall strategy.
- **Tool description** is shown every time the model picks the next action — influences per-step decisions.

So one edit in `search_issues`'s `description` can affect the trajectory more than adding a new rule to the system prompt. Details in `03-tool-design.md` (principle 2).

---

## Where the rakes are hidden

### Rake 1: long prompt without structure

A "wall of text" prompt — Sonnet manages, but as complexity grows (>800 tokens) the model starts losing details. Solution — **markdown sections** (`# Goal`, `# Tools`, `# Rules`, `# Output`), like we have. Sonnet 4.6 especially navigates such markdown structures well ([Anthropic docs](https://platform.claude.com/docs/en/about-claude/models/overview)).

### Rake 2: "few-shot examples" in the system prompt

The temptation: drop in "Example: { ... TriageCard ... }". Don't:

- few-shot examples in multi-step agents often **mislead** the model — it copies the example's structure literally, even if the context doesn't fit.
- they take many tokens (~500–1000 for a good example).
- they enlarge the cache key — if you edit the example, the entire cache on the system prompt is invalidated.

If you really need an example — make it **partial** ("here's how to format `suspectedFiles`: { path: '...', rationale: '...', confidence: 'high' }"), not a full TriageCard.

### Rake 3: conditional tasks that you don't validate

> `severity` (optional): ... only set when `category === "bug"`.

This is a rule. But no one checks that the model obeys it. If you want to enforce — add a Zod refinement:

```ts
TriageCard.refine(c => c.severity == null || c.category === 'bug', {
  message: 'severity is only valid when category is "bug"'
});
```

Otherwise this is a **soft contract**, and the model violates it in 1–2% of cases.

### Rake 4: "Be concise" without defining concise

If you write "Be concise" — the model decides for itself. For one "concise" = 3 sentences, for another — 30. Be specific: "Use 1–3 short paragraphs."

### Rake 5: meta-prompt vs prompt

Don't write "You are an AI agent designed to triage..." — that's **metainformation** (the model knows it's an agent). Write "You are a senior engineer..." — that's a **role**, and it shapes behavior.

---

## How to iterate the prompt

1. **Make a baseline** — the current prompt, an eval run, a number.
2. **Formulate a hypothesis** — "if I add 'Be decisive', `averageTrajectoryLength` will drop from 5.8 to 5.0".
3. **Make one change.** Not three. One. Bump `PROMPT_VERSION`.
4. **Run evals on a corpus ≥5 fixtures.** If the corpus is smaller — grow it to 10, because a single fixture gives 20% variance.
5. **Compare** with the baseline. If it improved — keep. If worse or equal — rollback, but **record** the change in a separate branch as a "negative result" for documentation.

This is your scientific method. Without it you're not doing prompt engineering — you're guessing.

---

## Prompting and prompt caching: the link

The cache breaks on **any** symbol change in the cached prefix. If you edit the system prompt — the cache for the system block is invalidated on that endpoint. That's normal — the next run re-creates a cache write (1.25× input price), subsequent ones read at 0.1×.

What matters:

- **Don't change the prompt between steps.** If in `prepareStep` you modify the system message — the cache breaks on every step. In `dedupRecentToolCalls` we **append** a reminder, but don't touch system — the system stays stable.
- **Stable tool names matter more than stable descriptions.** If you edit a tool description — the cache on the assistant context breaks, but that's okay because this part is shorter. Reworking the system prompt — more expensive.

---

## What to try

1. **Remove the "Working rules" section entirely.** Run evals. Compare `duplicateCallRate` and `averageTrajectoryLength`. You'll get concrete proof that those 4 lines actually work.
2. **Rewrite "Aim for 4–6 tool calls" to "Aim for 2–3".** Run. Most likely you'll see a drop in `categoryAccuracy` and `fileF1`, because the model doesn't get time to collect data. A counter-example of "less is better".
3. **Add to "Working rules": "Always call `search_issues` before `read_file`."** Run. Check in the SQLite trace whether the sequence changed. This is an experiment on forced-trajectory — is it worth it?
4. **Bump `PROMPT_VERSION` after each experiment.** After 10 experiments, look at `evals/results.json` — you'll have a time series by version, and you can build a cheap dashboard via `jq`.

---

## Summary of all 8 stages

If you've made it this far:

- You understand **why an agent is more expensive and more fragile than one-shot, and when it's justified**.
- You can stand up `streamText` + tools + stopWhen + prepareStep from scratch and explain each parameter.
- You understand **why exactly 6 tools**, and can apply the reasoning to another task.
- You build **two-layer defense against looping** and can measure it.
- You pull a typed object out of free text and validate it as a contract.
- You log the trajectory so that a month later you can debug someone else's run.
- You write evals **on the process**, not just the result.
- You treat the prompt as code — version it and validate it through numbers.

This is the baseline skill set for production agents. Next come multi-agent orchestration (project 04), human-in-the-loop, and safety/control layers — but they all build on top of this foundation.
