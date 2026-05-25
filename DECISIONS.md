# Architectural decisions

Each entry follows the form: **I chose X over Y because Z, and the cost of Z is W.**

---

## 1 — Six medium-grain tools, not one omnibus tool or fifteen micro-tools

**Chose:** A flat surface of six read-only tools — `get_issue`, `search_issues`, `search_code`, `read_file`, `list_directory`, `get_file_history` — each answering a single product-shaped question.

**Over:**
- (a) One omnibus `investigate_repo(question: string)` that routes internally. Trajectory becomes a single step that hides everything; you cannot eval the agent's reasoning, only its black-box answer. Tool-design is the *whole point* of this exercise, so opaque tools defeat the project.
- (b) Fifteen-plus micro-tools (`get_issue_title`, `get_issue_body`, `get_issue_comments`, …). Models burn steps on trivial gluing — a 4-step task balloons to 12 — and the dedup logic for "did we already fetch this issue?" gets diluted across a dozen variants of the same call.

**Because:** Six is the ceiling at which a model can hold the menu in working memory and pick the right tool first time. Each call answers a distinct question a senior engineer would actually voice while triaging ("what is this issue?", "have we seen something like it before?", "where in the source does this live?", "what are the recent changes here?"). The trajectories that come out read like a conversation, which matters for both human review and structured eval.

**Cost (W):** Some flows want a tool we don't have — `get_pr_diff`, `compare_branches`, a way to read a specific line range of a huge file. Empirically these are <5% of trajectories on `shadcn-ui/ui`; when they do come up the agent improvises with `read_file` + `get_file_history`. If that workaround pattern becomes >10% in a future eval, the right move is to add the seventh tool with a documented decision entry — not to make the existing tools more clever.

---

## 2 — `stopWhen: stepCountIs(8)` AND `prepareStep` dedup, not either alone

**Chose:** A two-layer stopping discipline — a hard step ceiling at 8, plus a `prepareStep` callback that detects when the previous two steps' first tool calls had identical name + identical args and injects a system-level reminder telling the model to stop or vary the call.

**Over:**
- (a) Just `stopWhen: stepCountIs(8)`. Without dedup, a confused agent loops on the same `search_issues` query until the cap, burning 8 calls of API quota and tokens to produce a worse answer than 4 well-chosen calls.
- (b) Just `prepareStep` dedup. Smart agents work around it by perturbing args ("dialog flicker" → "modal flickering" → "popup blink") — semantic duplicates the cheap structural check can't catch. Without a hard cap such an agent runs unbounded; one fixture run can spike well past 50K tokens.

**Because:** The two failure modes are different. A dumb loop is structural — same name, same args — and is best stopped *before* it accrues by injecting a reminder mid-trajectory. A wandering agent is semantic — different args, no real progress — and the only reliable defence is a wall: at step 8 it's done, regardless of whether it's "almost there." Belt and braces is cheap when each costs one line.

**Cost (W):** Some legitimately deep investigations get truncated at step 8. The eval surfaces this directly: `trajectoryLength === 8 && completeness < 1` is the diagnostic. If that pattern is consistently >10% across runs, the right escalation is to raise the cap (with a fresh decision entry) — not to disable the dedup or quietly ignore the truncation.

---

## 3 — Read-only tool surface, not mutating triage actions

**Chose:** All six tools are read-only against GitHub. The agent produces a `draftResponse` field; a human copies, edits, and posts it.

**Over:** A "full" triage bot with `comment_on_issue`, `add_label`, `close_as_duplicate`. That would shorten the loop from "agent suggests → human posts" to "agent acts" and look more impressive in a 30-second demo.

**Because:** Two reasons, each sufficient on its own:
1. **Safety.** This runs on a personal `GITHUB_TOKEN` against a third-party repo. A wrong label or premature close on `shadcn-ui/ui` is public, attributable, and not always reversible (notifications fire, mentions stick). The blast radius of a bad mutation is wildly out of proportion to the upside of automating the click.
2. **Reasoning honesty in evals.** With mutations enabled, the eval question "did the agent triage well?" gets entangled with "did it have authority to act?" Read-only keeps the eval purely about the *quality of the conclusion*, which is what we care about.

**Cost (W):** Demos look one click less magical. In an interview setting that's fine — the tradeoff itself is the demo (read-only is a deliberate constraint, mutations are the natural extension under proper guardrails like dry-run mode, label allowlists, and per-action confirmation). It's a stronger signal than the bot equivalent.

---

## 4 — AI Gateway for Anthropic + OpenAI, direct SDK for Google, ephemeral prompt caching only on Sonnet

**Chose:** Route Anthropic (`claude-sonnet-4-6`) and OpenAI (`gpt-4o`) through Vercel AI Gateway via `gateway('anthropic/...')` / `gateway('openai/...')`, with a single `AI_GATEWAY_API_KEY`. Keep Google (Gemini 2.5 Flash / Pro) on the direct `@ai-sdk/google` adapter. On the Sonnet path, attach `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }` to the system message at construction time, and re-attach the same marker to the rolling-tail message on every step inside `withAnthropicCache(prepareStep)`.

**Over:**
- (a) Direct provider SDKs for all three (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`). Three separate API keys to provision, rotate, and leak; three SDK versions to keep in lockstep with `ai`; no central place to observe model traffic. The convenience of "one import per provider" is real but isn't worth three credentials and three upgrade cadences when two of the providers route cleanly through one gateway.
- (b) Route Gemini through the Gateway too. Gateway's Gemini coverage lags Anthropic/OpenAI — request/response shape mismatches and missing fields show up in eval traces. Keeping Google on the direct SDK isolates that flakiness from the primary path.
- (c) Skip prompt caching, eat the cost. A clean Sonnet eval pass over the fixture set costs ~$7.65 without caching because each step re-bills the full accumulated context (system prompt + every prior tool call + every tool result). With ephemeral caching that drops to ~$1.50 — roughly a 5× cut on the metric we actually look at when iterating on prompts and tools. The math is dominated by the rolling tail: by step 6 the input prefix is ~50–70K tokens, and Anthropic charges cached reads at $0.30/M instead of $3/M.

**Because:** The two parts of this decision compose. Gateway gives one credential for the two providers that need none of their SDK's quirks; that simplification is what lets us be opinionated about provider-specific features when they actually matter. Ephemeral caching is one of those features — pure win on Sonnet, but it's an Anthropic concept (the AI SDK forwards `providerOptions.anthropic.*` straight through), so it can only be enabled when we know we're on the Sonnet path. The `isAnthropic = modelKey === 'sonnet'` gate in `agent/run.ts` is the single switch that flips both the initial system-message breakpoint and the `withAnthropicCache` `prepareStep` wrapper on or off; non-Anthropic models silently ignore the marker if it slips through, but the gate makes the intent visible in code.

The placement of cache breakpoints is deliberate: the system prompt gets a sticky breakpoint (it never changes mid-run, so it cache-hits on every step after step 1), and the per-step wrapper moves a second ephemeral breakpoint to the last message of each prepared step (so the growing tool-result tail re-enters cache every turn). The wrapper clones the message before stamping the marker, so the SDK's internal `messages` array doesn't accumulate stray `providerOptions` between steps.

**Cost (W):** Three real costs, each manageable. (i) AI Gateway adds one network hop and a small surcharge over direct provider pricing; in our metrics it's lost in the noise of LLM latency variance. (ii) When Gateway has an outage, both Anthropic and OpenAI go down together — we trade per-provider blast radius for per-gateway blast radius. Acceptable for a pet project; in production we'd add a direct-SDK fallback path. (iii) Caching only works if the cached prefix is byte-identical across steps. Any prompt edit, tool-description tweak, or non-deterministic field (timestamps, UUIDs) injected into the system prompt invalidates the cache and forces a write at 1.25× input price. We keep the system prompt static and version it via `PROMPT_VERSION`; eval rows record `promptVersion` so cache-cost regressions are visible in `evals/results.json`.
