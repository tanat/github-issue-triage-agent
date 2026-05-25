# Evals

Run a full grading sweep against `fixtures/issues.json`:

```sh
pnpm eval                # claude-sonnet-4-6
pnpm eval:gpt-4o         # gpt-4o
```

Each invocation calls the triage agent in-process per fixture, scores the
final TriageCard against the ground-truth fix-PR file set, and **appends**
one row to `evals/results.json`. The file is the source of truth — the
dashboard at `/eval` reads it directly.

## Per-issue rubric

| Metric | Formula |
|--------|---------|
| Category accuracy | exact match → 1, else 0 |
| File recall | `|actual ∩ expected| / |expected|` (with `.ts` / `.tsx` extension relaxation) |
| File precision | `|actual ∩ expected| / |actual|` |
| File F1 | `2·P·R / (P+R)` |
| Similar issues | Jaccard on issue numbers |
| Trajectory length | step count (reported, not scored) |
| Duplicate calls | count of consecutive identical-arg tool calls |
| Completeness | TriageCard validates? 1 / 0 |

Aggregate per issue: `0.4·category + 0.3·fileF1 + 0.2·similarRecall + 0.1·completeness`.

## Cross-model comparison

After both runs land in `results.json`, fill in the comparison below:

|                 | claude-sonnet-4-6 | gpt-4o |
|-----------------|------------------:|-------:|
| categoryAccuracy |                   |        |
| fileF1          |                   |        |
| similarIssueRecall |                |        |
| avg trajectory length |             |        |
| duplicateCallRate |                 |        |
| weightedAggregate |                 |        |

Observation: …
