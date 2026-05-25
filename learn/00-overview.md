# Learning map — GitHub Issue Triage Agent

You just finished project 02 (`streaming-symptom-intake`) — one `streamObject` call, typed JSON on the output. That's a typical **one-shot generation**: the model sees the input, writes the output, done.

This project is about something different. Here the model itself decides which tool to invoke, what to do with the response, when to stop. This is an **agent** — a loop in which the LLM is in control of control. And precisely because control has moved to the model, things will break in completely different places.

> This is the baseline agent pattern on Vercel AI SDK: `streamText` + `tools` + `stopWhen` + `prepareStep`. Claude Sonnet 4.6 is the default choice for agents because of instruction-following and tool-use stability ([Anthropic](https://www.anthropic.com/news/claude-sonnet-4-6)).

---

## Why this project, not "yet another weather bot"

Typical agent tutorial: model calls `get_weather`, returns a string, done. That teaches you nothing important, because:

- there's only one tool — no choice;
- the result is small — no context-overflow problem;
- the task is single-pass — no looping trap;
- there's only one "correct answer" — no point measuring the process.

GitHub issue triage is a different class of problem. Given: a link to an issue. Required: read the body and comments, find similar issues, check mentioned files, reconstruct context from commit history, and produce a structured `TriageCard`. The route is not predetermined. There are several tools. The budget is limited. And you need to check not the "correct answer", but **the process by which the model arrived at it**.

That gives you real engineering tasks:

- **Tool granularity.** 6 medium-grained tools, not one omnibus and not fifteen micro-calls. Why exactly 6 — in `03-tool-design.md`.
- **Stopping conditions.** Without explicit barriers, the worst-case agent loops `search_issues` in a circle and burns the token budget in 30 seconds. Two-layer defense: `stopWhen(stepCountIs(8))` on the outside + `prepareStep` dedup-reminder on the inside. This is the project's main exercise.
- **Typed final output from a text stream.** `streamText` doesn't know about `TriageCard`. The model writes a final text with JSON, `extractCard()` pulls it out and validates via Zod. This is the contract between free generation and typed consumer code.
- **Trajectory observability.** You need to log not one response, but the chain `(toolName, toolArgs, toolResult, latency, tokens)` for the whole run. SQLite + `inspect-trace.ts`.
- **Agent evals.** `categoryAccuracy`, `fileF1`, `similarIssueRecall`, `duplicateCallRate`, `trajectoryLength`. Not pass/fail, but numbers that move when the prompt changes.
- **Prompt caching.** Anthropic ephemeral cache on system prompt + rolling tail. Pays off from the third step on and cuts eval-run cost ~5× (~$7.65 → ~$1.50 on a full fixture-pass). Details in `02` and `08`.
- **Gateway routing.** Anthropic Sonnet 4.6 and OpenAI gpt-4o go through `gateway('anthropic/...')` / `gateway('openai/...')` from the `ai` package — single `AI_GATEWAY_API_KEY` variable. Google (Gemini 2.5 Flash / Pro) goes through direct `@ai-sdk/google`, because Gateway coverage for Gemini is less mature.

---

## Stage map

| # | File | What's covered | Difficulty |
|---|------|---------------|-----------|
| 1 | `01-mental-model.md` | Agent vs one-shot `generateText`: what changes in the architecture | Low |
| 2 | `02-agent-loop.md` | `streamText` + `tools` + `stopWhen` + `prepareStep` — loop mechanics | Medium |
| 3 | `03-tool-design.md` | Designing 6 tools: granularity, descriptions, input schema | High |
| 4 | `04-stopping-conditions.md` | **The main exercise** — `stopWhen` + dedup, two-layer defense | High |
| 5 | `05-typed-output.md` | `TriageCard` from text: `extractCard()`, Zod, schema versioning | Medium |
| 6 | `06-observability.md` | SQLite step log, `inspect-trace.ts`, `runs/*.json` | Medium |
| 7 | `07-evals.md` | Agent metrics: outcome + process, harness, `results.json` | High |
| 8 | `08-prompt-engineering.md` | System prompt + tool descriptions as first-class code | High |

---

## How to read

**Linearly.** 1–2 set up the mental model. 3–4 are the engineering core. Stage 4 is the most important: that's where agents in prod burn budget and fail to return a result. 5–6 are about how to extract a useful result and understand what happened. 7–8 are about how to measure and improve.

**With the code open next to you.** Each file references specific paths and lines in `03-github-issue-triage-agent/`. Don't take it on faith — open it and read.

**With `pnpm dev` running.** Open DevTools → Network → POST `/api/triage`. Watch the event stream: first `get_issue` step, then `search_issues`, finally the final JSON in `step_text`. A live trajectory is worth more than any diagram.

**After each stage — one real run.** Paste an issue URL from a public repo, look at the trace via `pnpm inspect-trace <runId>`. The gap between what's written in the docs and what the model actually did — that's the point of learning.

---

## Quick orientation in the code

```
agent/
  run.ts                 ← runTriage() + runTriageOnce() — the entire agent loop
                           STEP_HARD_CAP = 8, TOKEN_BUDGET = 50_000
  system-prompt.ts       ← one const + PROMPT_VERSION
  prepare-step-cache.ts  ← withAnthropicCache() — wrapper around dedup
  log.ts                 ← logStep() into SQLite

tools/
  registry.ts            ← one object, 6 keys — everything the model sees
  get-issue.ts           ← ALWAYS the first step (so the prompt says)
  search-issues.ts
  search-code.ts
  read-file.ts
  list-directory.ts
  get-file-history.ts
  __helpers__/dedup.ts   ← dedupRecentToolCalls — prepareStep callback

schemas/v1/
  triage-card.ts         ← Zod schema for the final TriageCard + SCHEMA_VERSION
  tools/*.ts             ← input/output schemas for each tool

evals/
  harness.ts             ← runs fixtures through runTriageOnce
  score.ts               ← scoreCategoryAccuracy, scoreFiles (F1), scoreTrajectory
  results.json           ← append-only run history

app/api/triage/route.ts  ← Next.js route, forwards the UI stream
```

---

## What's in your head after the project

- You can stand up an agent loop from scratch on AI SDK v6 and understand every line.
- You know **why exactly 6 tools**, not 1 and not 20, and can justify your decision for another task.
- You understand that `stopWhen` and dedup-reminder are **different layers of defense**, and why both are needed.
- You pull a typed object out of a free text stream and validate it without trusting the model.
- You log the trajectory so that a week later you can sit down and understand where the model went wrong.
- You write evals not as pass/fail tests, but as metrics you compare between runs.

After this the next project — `04-multi-agent-orchestration` — gives you several such loops in parallel with a coordinator. But without 03 it doesn't make sense.
