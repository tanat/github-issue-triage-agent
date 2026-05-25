import { describe, it, expect } from 'vitest';
import {
  scoreCategoryAccuracy,
  scoreFiles,
  scoreSimilarIssues,
  scoreTrajectory,
  scoreCompleteness,
  scoreIssue,
  aggregateScores,
} from '@/evals/score';
import type { TriageCard } from '@/schemas/v1/triage-card';

describe('scoreCategoryAccuracy', () => {
  it('returns 1 for exact match', () => {
    expect(scoreCategoryAccuracy('bug', 'bug')).toBe(1);
  });
  it('returns 0 for mismatch', () => {
    expect(scoreCategoryAccuracy('bug', 'feature')).toBe(0);
  });
  it('returns 0 when actual is null', () => {
    expect(scoreCategoryAccuracy(null, 'bug')).toBe(0);
  });
});

describe('scoreFiles', () => {
  it('F1 = 1 for identical sets', () => {
    expect(scoreFiles(['a.ts', 'b.ts'], ['a.ts', 'b.ts']).f1).toBe(1);
  });
  it('F1 = 0 for disjoint sets', () => {
    const r = scoreFiles(['a.ts'], ['b.ts']);
    expect(r.f1).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.precision).toBe(0);
  });
  it('partial overlap → 0 < F1 < 1', () => {
    const r = scoreFiles(['a.ts', 'b.ts'], ['a.ts', 'c.ts']);
    expect(r.recall).toBe(0.5);
    expect(r.precision).toBe(0.5);
    expect(r.f1).toBe(0.5);
  });
  it('extension differences match (.ts vs .tsx)', () => {
    const r = scoreFiles(['components/dialog.ts'], ['components/dialog.tsx']);
    expect(r.f1).toBe(1);
  });
  it('both empty → 1 (no claims, no truth)', () => {
    expect(scoreFiles([], []).f1).toBe(1);
  });
});

describe('scoreSimilarIssues', () => {
  it('Jaccard 1 for identical', () => {
    expect(scoreSimilarIssues([1, 2], [1, 2])).toBe(1);
  });
  it('Jaccard 0 for disjoint', () => {
    expect(scoreSimilarIssues([1], [2])).toBe(0);
  });
  it('Jaccard 1/3 for one shared of three total', () => {
    expect(scoreSimilarIssues([1, 2], [2, 3])).toBeCloseTo(1 / 3, 5);
  });
});

describe('scoreTrajectory', () => {
  it('no calls → length 0, duplicates 0', () => {
    expect(scoreTrajectory([])).toEqual({ length: 0, duplicateCount: 0 });
  });
  it('distinct args → no duplicates', () => {
    const steps = [
      { toolName: 'get_issue', toolArgs: { number: 1 } },
      { toolName: 'get_issue', toolArgs: { number: 2 } },
    ];
    expect(scoreTrajectory(steps)).toEqual({ length: 2, duplicateCount: 0 });
  });
  it('same tool same args twice → 1 duplicate', () => {
    const steps = [
      { toolName: 'get_issue', toolArgs: { owner: 'a', repo: 'b', number: 1 } },
      { toolName: 'get_issue', toolArgs: { owner: 'a', repo: 'b', number: 1 } },
    ];
    expect(scoreTrajectory(steps).duplicateCount).toBe(1);
  });
  it('key order does not matter', () => {
    const steps = [
      { toolName: 'search_issues', toolArgs: { query: 'x', limit: 5 } },
      { toolName: 'search_issues', toolArgs: { limit: 5, query: 'x' } },
    ];
    expect(scoreTrajectory(steps).duplicateCount).toBe(1);
  });
});

describe('scoreCompleteness', () => {
  it('returns 1 for valid card', () => {
    const valid: TriageCard = {
      category: 'bug',
      severity: 'medium',
      suspectedFiles: [
        { path: 'components/dialog.tsx', rationale: 'reproduces here', confidence: 'medium' },
      ],
      similarIssues: [],
      draftResponse: 'Thanks for the report — we are investigating this issue.',
      reasoning: 'Inspected the issue body and confirmed the affected component.',
    };
    expect(scoreCompleteness(valid)).toBe(1);
  });
  it('returns 0 for invalid card', () => {
    expect(scoreCompleteness({ category: 'made-up' })).toBe(0);
    expect(scoreCompleteness(null)).toBe(0);
  });
});

describe('scoreIssue + aggregateScores', () => {
  const baseFixture = {
    issueRef: 'shadcn-ui/ui#100',
    expectedCategory: 'bug' as const,
    expectedFiles: ['components/dialog.tsx'],
    expectedSimilarIssues: [42],
  };

  const goodCard: TriageCard = {
    category: 'bug',
    severity: 'medium',
    suspectedFiles: [
      { path: 'components/dialog.tsx', rationale: 'flicker on close', confidence: 'high' },
    ],
    similarIssues: [{ number: 42, title: 'similar', relevance: 'closely_related' }],
    draftResponse: 'Thanks for the report; investigating the dialog flicker now.',
    reasoning: 'Read issue, confirmed file in search_code, verified via read_file.',
  };

  it('per-issue and aggregate compute end-to-end', () => {
    const per = scoreIssue(
      {
        card: goodCard,
        steps: [
          { toolName: 'get_issue', toolArgs: { owner: 'shadcn-ui', repo: 'ui', number: 100 } },
          { toolName: 'search_code', toolArgs: { query: 'dialog', limit: 5 } },
        ],
      },
      baseFixture,
    );
    expect(per.fileF1).toBe(1);
    expect(per.similarIssueRecall).toBe(1);
    expect(per.completeness).toBe(1);
    expect(per.aggregate).toBeGreaterThan(0.9);
    const agg = aggregateScores([per, per]);
    expect(agg.count).toBe(2);
    expect(agg.weightedAggregate).toBe(per.aggregate);
  });
});
