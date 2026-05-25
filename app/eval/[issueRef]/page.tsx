import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PerIssueScore, AggregateScore } from '@/evals/score';
import type { Category } from '@/schemas/v1/triage-card';
import { DiffView } from '@/render/DiffView';

interface ResultRow {
  runId: string;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  perIssue: PerIssueScore[];
  aggregate: AggregateScore;
}

interface Fixture {
  issueRef: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  expectedCategory: Category;
  expectedFiles: string[];
  expectedSimilarIssues: number[];
}

function load<T>(file: string, fallback: T): T {
  const target = path.join(process.cwd(), file);
  if (!fs.existsSync(target)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ issueRef: string }>;
}) {
  const { issueRef: raw } = await params;
  const issueRef = decodeURIComponent(raw);
  const results = load<ResultRow[]>('evals/results.json', []);
  const fixtures = load<Fixture[]>('fixtures/issues.json', []);

  const fixture = fixtures.find((f) => f.issueRef === issueRef);
  const latest = results[results.length - 1];
  const perIssue = latest?.perIssue.find((p) => p.issueRef === issueRef);

  if (!fixture && !perIssue) notFound();

  const expected = fixture
    ? {
        category: fixture.expectedCategory,
        files: fixture.expectedFiles,
        similarIssues: fixture.expectedSimilarIssues,
      }
    : { category: 'other' as Category, files: [], similarIssues: [] };

  const actual = perIssue
    ? {
        category: perIssue.categoryActual,
        files: [],
        similarIssues: [],
      }
    : { category: null, files: [], similarIssues: [] };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{issueRef}</h1>
        <Link href="/eval" className="text-sm text-blue-600 underline">← back to dashboard</Link>
      </header>
      {fixture && (
        <p className="text-sm text-muted-foreground">{fixture.title}</p>
      )}
      {perIssue && (
        <section className="text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="aggregate" value={perIssue.aggregate.toFixed(2)} />
          <Stat label="file F1" value={perIssue.fileF1.toFixed(2)} />
          <Stat label="similar recall" value={perIssue.similarIssueRecall.toFixed(2)} />
          <Stat label="trajectory length" value={String(perIssue.trajectoryLength)} />
        </section>
      )}
      <DiffView actual={actual} expected={expected} />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-medium tabular-nums">{value}</div>
    </div>
  );
}
