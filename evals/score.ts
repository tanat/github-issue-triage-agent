import type { TriageCard, Category } from '@/schemas/v1/triage-card';
import { TriageCard as TriageCardSchema } from '@/schemas/v1/triage-card';

export interface ExpectedFixture {
  issueRef: string;
  expectedCategory: Category;
  expectedFiles: string[];
  expectedSimilarIssues: number[];
}

export interface PerIssueScore {
  issueRef: string;
  categoryActual: Category | null;
  categoryExpected: Category;
  fileRecall: number;
  filePrecision: number;
  fileF1: number;
  similarIssueRecall: number;
  trajectoryLength: number;
  duplicateToolCalls: number;
  completeness: number;
  aggregate: number;
}

export interface AggregateScore {
  count: number;
  categoryAccuracy: number;
  fileRecall: number;
  filePrecision: number;
  fileF1: number;
  similarIssueRecall: number;
  averageTrajectoryLength: number;
  duplicateCallRate: number;
  completeness: number;
  weightedAggregate: number;
}

export function scoreCategoryAccuracy(actual: Category | null, expected: Category): number {
  return actual === expected ? 1 : 0;
}

export function scoreFiles(
  actualPaths: string[],
  expectedPaths: string[],
): { recall: number; precision: number; f1: number } {
  const actual = new Set(actualPaths.map(normalizePath));
  const expected = new Set(expectedPaths.map(normalizePath));

  if (expected.size === 0 && actual.size === 0) {
    return { recall: 1, precision: 1, f1: 1 };
  }

  const intersection = new Set<string>();
  for (const a of actual) {
    if (expected.has(a)) intersection.add(a);
    else {
      // prefix-match relaxation: match a/b/c.tsx to a/b/c.* etc.
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

function normalizePath(p: string): string {
  return p.replace(/^\.?\//, '').toLowerCase();
}

function sharesMeaningfulPrefix(a: string, b: string): boolean {
  // Drop file extension, then compare. e.g. "x/y/z.ts" matches "x/y/z.tsx".
  const stripExt = (s: string) => s.replace(/\.[^./]+$/, '');
  return stripExt(a) === stripExt(b);
}

export function scoreSimilarIssues(actual: number[], expected: number[]): number {
  if (expected.length === 0 && actual.length === 0) return 1;
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  const a = new Set(actual);
  const e = new Set(expected);
  const inter = new Set([...a].filter((n) => e.has(n)));
  const union = new Set([...a, ...e]);
  return union.size === 0 ? 1 : inter.size / union.size;
}

export interface TrajectoryStep {
  toolName: string | null;
  toolArgs: unknown;
}

export interface TrajectoryReport {
  length: number;
  duplicateCount: number;
}

export function scoreTrajectory(steps: TrajectoryStep[]): TrajectoryReport {
  const length = steps.length;
  let duplicateCount = 0;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    if (
      prev.toolName !== null &&
      prev.toolName === curr.toolName &&
      stableStringify(prev.toolArgs) === stableStringify(curr.toolArgs)
    ) {
      duplicateCount += 1;
    }
  }
  return { length, duplicateCount };
}

export function scoreCompleteness(card: unknown): number {
  return TriageCardSchema.safeParse(card).success ? 1 : 0;
}

export function scoreIssue(
  actual: { card: TriageCard | null; steps: TrajectoryStep[] },
  expected: ExpectedFixture,
): PerIssueScore {
  const card = actual.card;
  const categoryActual = card?.category ?? null;
  const categoryAccuracy = scoreCategoryAccuracy(categoryActual, expected.expectedCategory);
  const filesActual = card?.suspectedFiles.map((s) => s.path) ?? [];
  const fileScores = scoreFiles(filesActual, expected.expectedFiles);
  const similarActual = card?.similarIssues.map((s) => s.number) ?? [];
  const similarRecall = scoreSimilarIssues(similarActual, expected.expectedSimilarIssues);
  const traj = scoreTrajectory(actual.steps);
  const completeness = scoreCompleteness(card);

  const aggregate =
    0.4 * categoryAccuracy +
    0.3 * fileScores.f1 +
    0.2 * similarRecall +
    0.1 * completeness;

  return {
    issueRef: expected.issueRef,
    categoryActual,
    categoryExpected: expected.expectedCategory,
    fileRecall: round(fileScores.recall),
    filePrecision: round(fileScores.precision),
    fileF1: round(fileScores.f1),
    similarIssueRecall: round(similarRecall),
    trajectoryLength: traj.length,
    duplicateToolCalls: traj.duplicateCount,
    completeness,
    aggregate: round(aggregate),
  };
}

export function aggregateScores(perIssue: PerIssueScore[]): AggregateScore {
  if (perIssue.length === 0) {
    return {
      count: 0,
      categoryAccuracy: 0,
      fileRecall: 0,
      filePrecision: 0,
      fileF1: 0,
      similarIssueRecall: 0,
      averageTrajectoryLength: 0,
      duplicateCallRate: 0,
      completeness: 0,
      weightedAggregate: 0,
    };
  }
  const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const categoryAccuracy = mean(
    perIssue.map((p) => (p.categoryActual === p.categoryExpected ? 1 : 0)),
  );
  return {
    count: perIssue.length,
    categoryAccuracy: round(categoryAccuracy),
    fileRecall: round(mean(perIssue.map((p) => p.fileRecall))),
    filePrecision: round(mean(perIssue.map((p) => p.filePrecision))),
    fileF1: round(mean(perIssue.map((p) => p.fileF1))),
    similarIssueRecall: round(mean(perIssue.map((p) => p.similarIssueRecall))),
    averageTrajectoryLength: round(mean(perIssue.map((p) => p.trajectoryLength))),
    duplicateCallRate: round(
      mean(perIssue.map((p) => (p.duplicateToolCalls > 0 ? 1 : 0))),
    ),
    completeness: round(mean(perIssue.map((p) => p.completeness))),
    weightedAggregate: round(mean(perIssue.map((p) => p.aggregate))),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
