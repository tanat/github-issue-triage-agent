# Tool design: why 6 medium-grained tools

## Why think about this at all

Tool design in an agent is **not "API design" in the usual sense**. You have an unstable, non-deterministic, context-sensitive consumer (LLM), and every name, every description, every field in the input schema either helps it make the right choice or pushes it into a loop.

If you approach this like a REST API — you'll be wrong. REST is optimized for a human or other code that has documentation and tests. At the moment of the call the LLM sees only what you sent in this request — name, description, input schema. That's all.

[Anthropic's recommendations for Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6) state this explicitly: **tool reliability scales with description quality, not parameter count**. A tool description is a micro-prompt, and it works by the same rules.

---

## The granularity spectrum

You have a choice between two extremes:

**Extreme A: one omnibus tool.**

```ts
{ name: "github", action: "..." }
```

Pros: less chance of picking the wrong tool.
Cons: the input schema balloons into unions; the model gets lost in fields; validation errors become opaque.

**Extreme B: fifteen micro-tools.**

```ts
get_issue_body, get_issue_labels, get_issue_comments, get_issue_reactions,
list_repo_files, get_file_size, get_file_content_head, get_file_content_tail, ...
```

Pros: each tool is simple and predictable.
Cons: the model spends a step on each micro-operation. 4 steps become 12. Cost grows linearly with the number of steps (token-input × count).

**The middle point — what we have.** Six tools cover the logical "chunks of work" of triage:

| Tool | What it does | Alternative decomposition |
|---|---|---|
| `get_issue` | issue + body + labels + reactions + comments in one call | 4 micro-tools |
| `search_issues` | search in issues by keywords | + `find_duplicate_issue` (no) |
| `search_code` | search in code | + `search_in_path` (no) |
| `read_file` | one file | + `read_function`, `read_lines` (no) |
| `list_directory` | directory contents | + `tree_at_depth` (no) |
| `get_file_history` | commits + extracted #issue refs | + `get_blame`, `get_pr_for_commit` (no) |

Each tool answers **one high-level question** that actually arises for the model during triage: "what's in this issue?", "what's similar to it?", "where is this symbol in the code?", "what's in this file?", "what's in this folder?", "who last touched this file and when?".

---

## Concrete principles — on our tools

### Principle 1: the name is the first part of the prompt

The tool's name lands in the model-side tool definitions. The model decides "call X or Y" first of all by name.

Our names:

- `get_issue` — verb-object, the action is obvious.
- `search_issues` vs `search_code` — parallel naming, "search_X" = "find in X".
- `read_file`, `list_directory` — standard verbs from the shell vocabulary the model knows.
- `get_file_history` — slightly longer, but honestly describes the result.

What doesn't work:

- `query_github`, `do_thing`, `helper` — meaningless, the model doesn't know when to pick;
- `read_file_or_directory` — ambiguous, the model will err on the type of the path;
- snake_case vs camelCase — not critical, but **inside one registry** must be consistent. We use snake_case.

### Principle 2: the description starts with the role in the route

From `tools/get-issue.ts`:

```ts
description:
  'Fetch a GitHub issue with its body, labels, reactions, and full comment thread. ' +
  'Use this as the first step in any triage to understand what the user is reporting.',
```

First sentence — what the tool does.
Second — **when to choose it**. "Use this as the first step in any triage" matches the rule in the system prompt ("ALWAYS start here") and creates a double anchor: even if the model missed the system rule, it'll see the hint in the tool description.

From `tools/search-issues.ts`:

```ts
description:
  'Search issues in this repository by keywords. Use to find related or duplicate issues. ' +
  'Pass plain keywords; do not include `repo:` or `is:issue` qualifiers — they are added for you.',
```

Here the description **prevents a class of errors**: the model often tries to stuff in GitHub search qualifiers (`repo:foo/bar is:issue label:bug`). We'll add `repo:` and `is:issue` ourselves, and saying so in the description is cheaper than later figuring out why `search_issues` finds nothing.

> **Octokit nuances.** In `tools/search-issues.ts` we pass `advanced_search: 'true'` to `octokit.rest.search.issuesAndPullRequests` — without the flag the API returns an empty array for a non-trivial query. In `tools/search-code.ts` there's a parallel nuance: `headers: { accept: 'application/vnd.github.text-match+json' }`, otherwise `text_matches[].fragment` is empty and only the file path remains in the snippet. Both are invisible-critical: the code compiles, the tools return data, but triage quality drops through the floor.

A counter-example of a description that doesn't work: "Search for stuff." — the model doesn't know what stuff is, and doesn't know when to choose this tool over `search_code`.

### Principle 3: the input schema is the last line of defense against junk

All our tools use Zod schemas from `schemas/v1/tools/`. This matters for two reasons:

1. **Zod descriptions become `.describe()` in the JSON schema the model sees.** If you write `query: z.string().describe("Plain keywords ...")`, the description rides into the tool definition. The model takes it into account.
2. **Validation fails early.** If the model sent `limit: 1000`, we refuse right away — rather than poking the GitHub API, which would return 422 and burn rate-limit budget.

Example from `schemas/v1/tools/search-issues.ts`:

```ts
export const SearchIssuesInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  query: z.string().min(1).describe(
    'Plain keywords or a short phrase. Do NOT pass full GitHub search syntax — qualifiers like ' +
    '`repo:` and `is:issue` are added internally.',
  ),
  state: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.number().int().min(1).max(20).default(10),
});
```

What's done here:

- `state` has default `'all'` — the model can omit it and search still works;
- `limit` is capped at 20 (rather than 100, as GitHub allows) — saves tokens and rate-limit. Default 10 — a good number for triage;
- `query.describe()` duplicates the constraint from the tool description. Duplication here isn't bad: the model is simply instructed twice, error chance is lower.

### Principle 4: output should be sensibly compressed

GitHub returns ~50 fields on `issues.get`. The model needs ~12 of them. If you pass all 50 — you pay for tokens, clutter the context, and give the model reasons to get distracted.

From `tools/get-issue.ts`:

```ts
return {
  number: issue.data.number,
  title: issue.data.title,
  state: issue.data.state,
  body: issue.data.body ?? '',
  author: issue.data.user?.login ?? null,
  createdAt: issue.data.created_at,
  labels: (issue.data.labels ?? []).map((l) =>
    typeof l === 'string' ? l : (l.name ?? '')
  ).filter(Boolean),
  comments: comments.data.map((c) => ({
    author: c.user?.login ?? null,
    body: c.body ?? '',
    createdAt: c.created_at,
  })),
  reactionSummary: Object.keys(reactions).length > 0 ? reactions : undefined,
};
```

Note:

- we pulled only the needed fields of the issue + comments;
- labels are normalized (they come either as string or object — a real GitHub API gotcha);
- `reactionSummary` is optional and not serialized when empty (saves tokens on 80% of issues without reactions);
- `comments` are flattened — for the model the difference between an issue-comment and a review-comment doesn't matter in this context.

This is inverse-design from the LLM consumer: what would I want to see in the model's place?

### Principle 5: hard limits on size

`read_file` caps content:

```ts
const MAX_BYTES = 100 * 1024;
const HEAD_BYTES = 50 * 1024;
const TAIL_BYTES = 10 * 1024;

if (buffer.length > MAX_BYTES) {
  const head = buffer.subarray(0, HEAD_BYTES).toString('utf8');
  const tail = buffer.subarray(buffer.length - TAIL_BYTES).toString('utf8');
  return {
    path, size,
    content: `${head}\n\n... [truncated ${buffer.length - HEAD_BYTES - TAIL_BYTES} bytes] ...\n\n${tail}`,
    truncated: true,
  };
}
```

Why head+tail rather than the first 100K?

- In large files, the most important parts are often at the beginning (imports, types, main functions) and at the end (exports, tests). The middle is implementation, which the model isn't going to read anyway.
- The `[truncated N bytes]` marker explicitly tells the model "not the whole truth, you can use `search_code` for a specific location".
- The `truncated: true` field in the output is a machine-readable signal for evals and for the model itself.

Without this, a single big file can occupy 80K tokens and eat the entire cache headroom.

### Principle 6: tools are read-only — and you have to say so

From the system prompt:

> Tools are read-only. You cannot post, label, or close — only investigate.

This is **not a technical constraint** (the tools simply have no write methods), it's **behavioral**. Otherwise the model tries, for example, to "propose adding a label" in the final answer as if it could add it. An explicit declaration turns the draft response into "here's text the maintainer can paste in", not "I closed the issue".

This is especially important for Sonnet 4.6 — it's trained to call tools more aggressively and tries to "help". Without an explicit "read-only" it'll start inventing tools that don't exist.

---

## Where the traps are hidden

### Trap 1: overlapping tools

If you have `read_file` and `read_directory` both accepting `path`, and the model doesn't know what's at the path — it'll get it wrong. One of them will fail, and a step is lost.

Our defense: `read_file` throws a meaningful error if the path is a directory:

```ts
if (Array.isArray(data) || typeof data !== 'object' || data === null) {
  throw new Error(`Path ${path} is a directory or not a regular file. Use list_directory instead.`);
}
```

The error text reaches the model as a tool_result, and on the next step it'll correct the choice. This is "self-correcting" behavior, but it costs a step. If you can distinguish in advance — don't overlap.

### Trap 2: a tool that **may** return empty but doesn't explain why

If `search_issues` returns `[]`, the model may decide "so there are no duplicates" and move on. Or — "so my query is bad" and reformulate. Without a hint in the output, it guesses.

In our implementation we return the array as-is. Here you could add `meta: { query: finalQ, hint: "Try different keywords if empty" }`, but it's a compromise: more tokens on every call vs a better hint in 1 of 5 cases. Per our evals, not needed yet.

### Trap 3: `cachedCall` compresses the same handle, but that's not idempotence

Each tool has `cachedCall('issues.get', { owner, repo, number }, () => ...)`. This is a **process-local** cache (see `github/client.ts`), and it:

- saves you from repeat identical calls within a single run (useful when the model did repeat the call before dedup fired);
- does NOT save you from semantically identical but syntactically different queries: `search_issues({ query: "rate limit" })` and `search_issues({ query: "rate-limit" })` are two different cache keys.

Don't confuse this cache with Anthropic's prompt caching: the former caches tool responses, the latter caches the prompt prefix in the LLM. They are independent.

---

## Ecosystem context

- **Sonnet 4.6 follows instructions well and rarely invents tools**, so you can afford laconic descriptions — 1–2 sentences, if they give a clear "when to choose" signal.
- **The AI SDK formalizes the tool API** via `tool({ description, inputSchema, execute })` ([Vercel docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)).
- **GitHub API rate limits** — 5000/hour on user PAT, 15000/hour on GitHub App. For an eval run (5 fixtures × ~5 calls) this isn't a limit, but at 50+ fixtures add `@octokit/plugin-throttling` ([octokit](https://github.com/octokit/plugin-throttling.js/)).

---

## What to try

1. Change the `search_issues` description: remove the second sentence about "no qualifiers". Run 5 fixtures. Look in SQLite, how many times the model sent `query` with `repo:` or `is:issue`. That gives you a quantitative measure of the value of one sentence.
2. Merge `read_file` and `list_directory` into a single tool `read_path`. Measure `duplicateCallRate` and `averageTrajectoryLength`. Most likely you'll see a rise in "directory vs file" errors and an increase in the number of steps.
3. Remove the `truncated` flag from `ReadFileOutput`. Run on a big file. See if the model mentions "I see only part of the file" in reasoning — without the flag it doesn't know.

Next — `04-stopping-conditions.md`: the project's main architectural pattern, two-layer defense against looping and cap-hit.
