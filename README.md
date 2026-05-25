# GitHub Issue Triage Agent

> You feed in any issue from a public repo — the agent picks 4–8 steps on its own: hits the issue tracker, searches for similar issues, reads files, looks at commit history — and assembles a typed triage card with category, suspected files, links to similar issues, and a draft response. Every step is visible in real time.

---

## What it is and why

This is the third project in your AI Product Engineer portfolio. After Clinical Trial Extractor (`generateObject`) and Streaming Symptom Intake (`streamObject` + `useObject`) — this one is **agent loops**.

Technically: `streamText` + `tools` + `stopWhen` + `prepareStep` — four AI SDK primitives, hands-on, plus Anthropic prompt caching wired through `providerOptions`. Plus tool design for a non-deterministic consumer.

Domain-wise: GitHub. Every engineer knows what an issue, a file, and a commit are. You don't have to explain context in the demo — you just paste an issue URL and a few seconds later you can see the agent triaging it.

## Wow moment

You open the page. You paste a URL of an issue from a noisy public repo (e.g. [shadcn-ui/ui#4123](https://github.com/shadcn-ui/ui/issues)). You hit Triage.

On the left — a panel with the agent's steps, **streaming in real time**:

```
[Step 1] 🔧 get_issue ({ owner: "shadcn-ui", repo: "ui", number: 4123 })
         ↳ Got: "Dialog component flickers on mobile when scrolling"
         ↳ Author opened on 2025-12-01, has 8 comments, 3 reactions
[Step 2] 🔧 search_issues ({ q: "dialog mobile flicker", in: "shadcn-ui/ui" })
         ↳ Found 5 similar issues, top match #3891 (closed)
[Step 3] 🔧 read_file ({ path: "apps/www/registry/new-york/ui/dialog.tsx" })
         ↳ 287 lines read
[Step 4] 🔧 get_file_history ({ path: "apps/www/registry/new-york/ui/dialog.tsx" })
         ↳ Last 10 commits, 2 mention scroll-lock
[Step 5] ✅ Final triage:
         category: bug
         severity: medium
         suspected_files: ["dialog.tsx", "scroll-lock.ts"]
         similar_issues: [#3891]
         draft_response: "Thanks for the report! ..."
```

On the right — the final typed triage card, ready to be pasted into an issue comment.

## Data source

[GitHub REST API](https://docs.github.com/en/rest) via `@octokit/rest`:

- **Free with a PAT** (Personal Access Token): 5000 requests/hour
- **Free without authentication**: 60 requests/hour (too few for evals)
- The project needs a PAT with `public_repo` scope

For the pet scope you pick **one repo** as your test corpus. Recommended: [shadcn-ui/ui](https://github.com/shadcn-ui/ui) — active, mid-sized, clear bugs, every web developer knows it.

## Ground truth from git history

Every closed issue in shadcn-ui/ui links to the PR that fixed it. That PR changed specific files — exactly the ground truth for "suspected files":

- Issue → linked PR → `git diff` → set of changed files = expected suspected files
- Issue → final label or resolution comment = expected category
- Issue → mentioned-in-comments other issues = expected similar issues

No hand-labeling. Ground truth is development history that's already publicly available.

## What NOT to do

- ❌ Multi-user authentication — your token in env, that's it
- ❌ Redis or DB cache — Octokit cache + local SQLite is enough
- ❌ Webhooks for real-time triggers — manual paste URL → agent run
- ❌ GitLab / Bitbucket support — GitHub only
- ❌ Mutating actions (commenting, closing issues) — read-only agent. This is a **deliberate restriction** for safety; documented in DECISIONS.md
- ❌ UI polish — the main demo feature is the streaming trace, the rest is shadcn defaults

## What to do

- ✅ 6 typed tools: `get_issue`, `search_issues`, `search_code`, `read_file`, `list_directory`, `get_file_history`
- ✅ Agent loop via `streamText` with `tools` and `stopWhen: stepCountIs(8)`
- ✅ Typed triage card via post-parse (`extractCard` + Zod) from the streamed text
- ✅ Anthropic ephemeral prompt caching on system + rolling tail (Sonnet-only)
- ✅ Streaming trace UI (left panel) + final card (right panel)
- ✅ 25 fixture issues from shadcn-ui/ui with ground truth from their linked PRs
- ✅ Eval harness: category accuracy, file recall, trajectory analysis
- ✅ Per-step observability log (SQLite)
- ✅ DECISIONS.md (4 architectural forks)
- ✅ Deploy to Vercel

## Documentation files

- **README.md** (this file) — what and why
- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack, tool design, agent loop, eval rubric, observability
- [DECISIONS.md](./DECISIONS.md) — four architectural forks with rationale and cost

## Running locally

1. `pnpm install`
2. Copy `.env.local.example` to `.env.local` and set:
   - `AI_GATEWAY_API_KEY` — one key covers both Claude Sonnet 4.6 and GPT-4o via Vercel AI Gateway
   - `GOOGLE_GENERATIVE_AI_API_KEY` (optional) — Gemini stays direct via `@ai-sdk/google`, free at aistudio.google.com
   - `GITHUB_TOKEN` — a fine-grained PAT with `public_repo` read access (see https://github.com/settings/tokens?type=beta)
3. `pnpm dev` — open http://localhost:3000, paste a `shadcn-ui/ui` issue URL.
4. `pnpm test` — URL-parser, tool-schema, dedup, and scorer unit tests.
5. `pnpm build-fixtures` — fetches ground-truth file lists for the issue refs in `scripts/build-fixtures.ts`.
6. `pnpm eval` — runs the agent over `fixtures/issues.json` and appends a row to `evals/results.json`.
7. `pnpm exec tsx scripts/inspect-trace.ts <runId>` — pretty-prints any logged run from `logs/steps.sqlite`.

## Switching models

**UI** — the model selector dropdown on the main page lets you pick per-run:
- **Claude Sonnet 4.6** — best overall quality, routed through `gateway('anthropic/claude-sonnet-4-6')`. Ephemeral prompt caching is enabled on this model only, cutting eval cost ~5×.
- **GPT-4o** — routed through `gateway('openai/gpt-4o')`.
- **Gemini 2.5 Flash** — fast and cheap, free tier on Google AI Studio, ~10-15% lower accuracy. Direct via `@ai-sdk/google`.
- **Gemini 2.5 Pro** — quality close to Sonnet. Direct via `@ai-sdk/google`.

**Eval** — each model appends its own row to `evals/results.json` so runs are always comparable:

```bash
pnpm eval                # Claude Sonnet 4.6
pnpm eval:gemini-flash   # Gemini 2.5 Flash
pnpm eval:gemini-pro     # Gemini 2.5 Pro
pnpm eval:gpt-4o         # GPT-4o
```

Open `/eval` in the browser to see per-model aggregate scores and per-issue diffs side by side.

## What this demonstrates

- **Tool design under uncertainty.** Six read-only tools at medium granularity, each accepting plain inputs (not GitHub query syntax) so the model can't hallucinate qualifiers. Decisions in [DECISIONS.md](./DECISIONS.md).
- **Two-layer stopping discipline.** `stopWhen: stepCountIs(8)` plus a `prepareStep` deduplicator that catches structural loops mid-trajectory. Verified by unit tests in `tools/__tests__/dedup.test.ts`.
- **Prompt-cache-aware step preparation.** `withAnthropicCache` wraps the dedup `prepareStep` and pins an ephemeral cache breakpoint to the rolling message tail each step; the system prompt carries its own sticky breakpoint. Sonnet-only — non-Anthropic providers ignore the marker.
- **Gateway routing for Anthropic + OpenAI.** A single `AI_GATEWAY_API_KEY` covers both `claude-sonnet-4-6` and `gpt-4o`; no per-provider keys, no per-provider SDKs. Google stays direct because Gateway's Gemini support is less mature.
- **Eval ground truth from real fix PRs.** Per-issue scores combine category match, file F1 against the actual PR fix, similar-issue Jaccard, and TriageCard schema completeness.

## Deploying

The repo is Vercel-ready: `logs/` SQLite writes and `runs/*.json` writes are gated on `process.env.VERCEL`. In production the eval data committed to `evals/results.json` is the source of truth — runtime logging is disabled. Set `AI_GATEWAY_API_KEY`, optionally `GOOGLE_GENERATIVE_AI_API_KEY`, and `GITHUB_TOKEN` in the Vercel dashboard.
