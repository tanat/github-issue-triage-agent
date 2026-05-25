# Evals: outcome + process, trajectory metrics

## Why agent eval is a different genre

When you eval a one-shot task (for example, `streamObject` from project 02), you have:

- the expected object;
- the actual object;
- the diff.

That's all. The metric is a single scalar (per-field accuracy, or semantic similarity, or something simple).

For an agent this isn't enough. Suppose the agent produced a correct `TriageCard`. Fine. But:

- it took 8 steps instead of 4 — costs 2× more;
- 3 of the 8 steps were duplicates — the model was confused;
- one of the 4 `suspectedFiles` is hallucinated (not visible to tools).

From the "answer is correct" angle — pass. From the "agent works well" angle — disaster.

So agent evals are **two-dimensional**: outcome (correctness of the result) + process (quality of the trajectory). This matches the approach of [TRACE](https://arxiv.org/html/2602.21230v1) and [LangSmith trajectory evaluations](https://docs.langchain.com/langsmith/trajectory-evals).

---

## The metrics we compute

From `evals/score.ts`:

| Metric | Type | What it measures |
|---|---|---|
| `categoryAccuracy` | outcome | did it guess `category` |
| `fileF1` (recall, precision) | outcome | intersection of `suspectedFiles` with the reference |
| `similarIssueRecall` | outcome | Jaccard of `similarIssues` numbers with the reference |
| `completeness` | outcome | is the `TriageCard` valid against the schema |
| `trajectoryLength` | process | how many steps |
| `duplicateToolCalls` | process | how many consecutive duplicates in the trace |
| `aggregate` | composite | weighted-sum for a one-number summary |

Let's go through each.

### `categoryAccuracy` — simple 0/1

```ts
export function scoreCategoryAccuracy(actual: Category | null, expected: Category): number {
  return actual === expected ? 1 : 0;
}
```

The most loaded metric — the project's main goal. 0 or 1. Averaged over the corpus.

Pitfall: classes are imbalanced. If 80% of fixtures are `bug`, then an agent that always answers `bug` will get 0.8 with no work. Solution: either balance the fixtures, or compute **per-class precision/recall**. With us so far it's 5 fixtures and aggregate accuracy is enough, but as you grow to 50+ — switch to a confusion matrix.

### `fileF1` — F1 on path intersection

```ts
export function scoreFiles(actualPaths: string[], expectedPaths: string[]):
  { recall: number; precision: number; f1: number }
{
  const actual = new Set(actualPaths.map(normalizePath));
  const expected = new Set(expectedPaths.map(normalizePath));

  if (expected.size === 0 && actual.size === 0) return { recall: 1, precision: 1, f1: 1 };

  const intersection = new Set<string>();
  for (const a of actual) {
    if (expected.has(a)) intersection.add(a);
    else {
      for (const e of expected) {
        if (sharesMeaningfulPrefix(a, e)) {
          intersection.add(a);
          break;
        }
      }
    }
  }
  const recall = expected.size === 0 ? 1 : intersection.size / expected.size;
  const precision = actual.size === 0 ? (expected.size === 0 ? 1 : 0) : intersection.size / actual.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { recall, precision, f1 };
}
```

What's non-trivial here:

**Prefix relaxation.** If the reference is `src/foo/bar.tsx`, and the agent said `src/foo/bar.ts` (without `x`) — that still counts as matched, because `stripExt` makes them equal. This is **not** "fuzzy comparison" in the bad sense — it's compensation for the fact that the repo may contain `.ts` and `.tsx` versions, and the reference in the fixture might have been pinned just once.

**Edge cases:**
- expected empty and actual empty → 1.0 (we waited for nothing, we got nothing — perfect);
- expected empty and actual non-empty → precision = 0 (false positives);
- expected non-empty and actual empty → recall = 0.

F1 — the harmonic mean, which penalizes asymmetric precision/recall. If recall = 1, precision = 0.2 (the agent returned 5 files, of which 1 is correct) → F1 = 0.33. That's fairer than "average".

### `similarIssueRecall` — Jaccard

```ts
export function scoreSimilarIssues(actual: number[], expected: number[]): number {
  if (expected.length === 0 && actual.length === 0) return 1;
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  const a = new Set(actual);
  const e = new Set(expected);
  const inter = new Set([...a].filter((n) => e.has(n)));
  const union = new Set([...a, ...e]);
  return union.size === 0 ? 1 : inter.size / union.size;
}
```

This is the **Jaccard index**: |A ∩ E| / |A ∪ E|. Symmetric in precision/recall — penalizes both missed reference issues and extra "made-up" ones.

Why Jaccard, not F1? F1 leans on the positive/negative distinction — for similar issues this is less natural (there's no notion of "true negative"). Jaccard is a set similarity measure, and here that's semantically right.

### `completeness` — is the TriageCard valid

```ts
export function scoreCompleteness(card: unknown): number {
  return TriageCardSchema.safeParse(card).success ? 1 : 0;
}
```

0/1. If even one field doesn't pass Zod — 0. This is a binary "contract fulfilled" check, and it matters because zero completeness zeroes the aggregate **for that fixture**.

### `trajectoryLength` — how many steps

From `scoreTrajectory`:

```ts
const length = steps.length;
```

The average over the corpus is `averageTrajectoryLength`. The smaller, the cheaper. Target — 4–6 steps. If consistently 7–8 — something's off with the prompt or with tool design.

### `duplicateToolCalls` — consecutive duplicates

```ts
let duplicateCount = 0;
for (let i = 1; i < steps.length; i++) {
  const prev = steps[i - 1];
  const curr = steps[i];
  if (prev.toolName !== null &&
      prev.toolName === curr.toolName &&
      stableStringify(prev.toolArgs) === stableStringify(curr.toolArgs)) {
    duplicateCount += 1;
  }
}
```

Exactly the same logic as in `dedupRecentToolCalls`, and this is **intentional**: the metric checks the very class of loops dedup tries to catch. If dedup works — duplicateCount → 0. If it doesn't — you see it in evals.

In aggregate it's expressed via `duplicateCallRate`:

```ts
duplicateCallRate: round(mean(perIssue.map((p) => (p.duplicateToolCalls > 0 ? 1 : 0)))),
```

This is the **share of fixtures where there was at least one duplicate**. Not the count of duplicates. Why so — because one duplicate on one fixture is worse than three duplicates on one; and you care about **how many tasks** the agent gets confused on.

### `aggregate` — composite metric

```ts
const aggregate =
  0.4 * categoryAccuracy +
  0.3 * fileScores.f1 +
  0.2 * similarRecall +
  0.1 * completeness;
```

Weights:

- 0.4 on `categoryAccuracy` — the main thing a triager has to do;
- 0.3 on `fileF1` — the second most important task, investment-expensive to implement;
- 0.2 on `similarRecall` — a nice bonus, not critical;
- 0.1 on `completeness` — sanity, shouldn't be the main signal.

This is **subjective weighting**. When product priorities change — change the weights. Document the change in the commit ("bumped fileF1 weight from 0.3 to 0.4 because customer X complained about wrong files").

Aggregate is a `one-number summary` for dashboards. Not for decisions "prompt A vs B" — for that look at individual metrics.

---

## Harness: `evals/harness.ts`

```ts
const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const perIssue: PerIssueScore[] = [];
const startedAt = new Date().toISOString();

for (const fx of fixtures) {
  const url = `https://github.com/${fx.owner}/${fx.repo}/issues/${fx.number}`;
  try {
    const result = await runTriageOnce({
      issueUrl: url,
      parsedSummary: `(Parsed: owner=${fx.owner}, repo=${fx.repo}, number=${fx.number}.)`,
      modelKey,
    });
    const per = scoreIssue(
      { card: result.card, steps: result.steps },
      { issueRef: fx.issueRef, expectedCategory: fx.expectedCategory,
        expectedFiles: fx.expectedFiles, expectedSimilarIssues: fx.expectedSimilarIssues },
    );
    perIssue.push(per);
    console.log(...);
  } catch (err) {
    console.log(`FAIL: ${(err as Error).message}`);
  }
}

const row: ResultRow = {
  runId: startedAt,
  schemaVersion: SCHEMA_VERSION,
  promptVersion: PROMPT_VERSION,
  model: MODEL_IDS[modelKey],
  perIssue,
  aggregate: aggregateScores(perIssue),
};

// append to evals/results.json
history.push(row);
fs.writeFileSync(resultsPath, JSON.stringify(history, null, 2));
```

What matters:

**Sequential, not parallel.** We run fixtures one by one. This is slow (5 fixtures × 30 seconds = 2.5 minutes), but:
- doesn't run into GitHub rate limits;
- easy to debug — you see which fixture went wrong;
- the `[run ...]` logs don't get interleaved.

If you scale up to 50+ fixtures — parallelize to 3–5 concurrent runs and add `@octokit/plugin-throttling`.

**Try/catch around each fixture.** One failure doesn't kill the entire run. This is critical for us, because the GitHub API occasionally lags.

**Append-only `evals/results.json`.** We don't overwrite, we append. This gives a time series:

```
results.json:
  [run @ 2026-05-10] aggregate = 0.65
  [run @ 2026-05-12] aggregate = 0.71  ← after a prompt fix
  [run @ 2026-05-15] aggregate = 0.68  ← regression after a new model
```

This is your main dashboard. You don't need Grafana and Prometheus — `cat evals/results.json | jq '.[-5:] | .[].aggregate'`.

### Versioning in every row

```ts
schemaVersion: SCHEMA_VERSION,
promptVersion: PROMPT_VERSION,
model: MODEL_IDS[modelKey],
```

Without this, a month from now it's unclear which comparison is valid. With it — filter "only runs with the same promptVersion".

---

## Trajectory eval: what and how to check

Trajectory evals fall into several classes ([Arize](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations), [Strands](https://strandsagents.com/docs/user-guide/evals-sdk/evaluators/trajectory_evaluator/)):

- **Exact match** — the tool sequence matches the reference exactly. Too strict for our task (valid alternatives exist).
- **Set match (Jaccard)** — intersection of the sets of called tools. What we do for `similarIssues`. Not very informative for a trajectory, because it ignores order.
- **Order-preserving subsequence** — all expected steps are present, in the right order, with possible insertions. This is a compromise.
- **LLM-as-judge** — a separate LLM call "rate whether this trajectory is reasonable". Expensive, but universal.

With us so far it's **only duplicates and length**, without comparing to a reference trajectory. Why so:

- On 5 fixtures it's hard to collect stable expected-trajectories.
- Duplicates + length already catch 80% of problems (looping + wastefulness).
- As the corpus grows, you'll add expected-trajectory to fixtures (like `expectedSimilarIssues`, but for tools).

The evolutionary path:

```ts
interface ExpectedFixture {
  ...
  expectedTrajectoryPrefix?: string[];  // e.g. ['get_issue', 'search_issues']
}

function scoreTrajectoryMatch(actual: string[], expected: string[]): number {
  // order-preserving subsequence check
}
```

---

## Failure modes in the eval pipeline

### Case 1: GitHub API lags

One fixture fell with a timeout. `try/catch` catches it, the rest continue. In `evals/results.json` the missing fixture is absent. Aggregate is computed over what's there. This is a **silent bias**: if the same fixture (for example, the hardest one) consistently fails — your average metric is artificially inflated.

Defense: look at `count` in aggregate. If the corpus has 5 fixtures, but `count = 4` — someone failed, investigate.

### Case 2: eval ran, but `card === null`

The run took place, but the final isn't valid. `scoreIssue` handles it: all file/similar metrics = 0 (no card), `categoryAccuracy = 0` (categoryActual = null), `completeness = 0`. Aggregate for this fixture = 0.

That's correct — a `null` result should be penalized to the fullest.

### Case 3: the model added invented files

`agent/system-prompt.ts`:

> `path` MUST be a path you observed via `read_file`, `search_code`, `get_file_history`, or `list_directory`. Do not guess.

But the model still invents sometimes. In eval this is visible as `filePrecision < 1` with `fileRecall = 1` — the agent listed more files than needed.

Defense: you can add a post-validation that walks through `card.suspectedFiles` and checks that each path was mentioned in some tool_result. This is an automatic anti-hallucination check. Not yet implemented (TODO for the next iteration).

---

## What to try

1. Run `pnpm eval --model=sonnet`. Open `evals/results.json`, find your run. Look at the aggregate.
2. Run `pnpm eval --model=gpt-4o`. Compare. Most likely Sonnet 4.6 wins on our fixtures — and it should.
3. Pull up `evals/results.json`, look at the last 5 runs via `jq`:

   ```bash
   jq '.[-5:] | map({prompt: .promptVersion, model: .model, agg: .aggregate.weightedAggregate})' evals/results.json
   ```

   If you didn't change anything — the numbers should be stable ±0.05. If the spread is larger — it's model noise, and you need to grow the corpus or run each fixture 3 times.

4. Add your own fixture to `fixtures/issues.json` (run `pnpm build-fixtures`). Run the eval. See where the agent fails — that's the material for improving the prompt.

Next — `08-prompt-engineering.md`: system prompt as first-class code, not a "comment".
