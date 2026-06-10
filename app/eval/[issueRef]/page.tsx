import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { PerIssueScore, AggregateScore } from '@/evals/score';
import type { Category } from '@/schemas/v1/triage-card';
import { DiffView } from '@/render/DiffView';
import { StatCard, formatPct, scoreColor } from '@/render/eval-ui';

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

  const issueHref = fixture
    ? `https://github.com/${fixture.owner}/${fixture.repo}/issues/${fixture.number}`
    : undefined;

  return (
    <main className="app-aurora flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <code className="font-mono text-xl font-semibold tracking-tight">{issueRef}</code>
              {issueHref && (
                <a
                  href={issueHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  open <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {fixture && (
              <p className="max-w-2xl text-sm text-muted-foreground">{fixture.title}</p>
            )}
          </div>
          <Link
            href="/eval"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card/60 px-3 py-1.5 text-sm font-medium text-muted-foreground ring-1 ring-foreground/[0.04] transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
        </header>

        {perIssue && (
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Aggregate"
              value={perIssue.aggregate.toFixed(2)}
              tone={scoreColor(perIssue.aggregate)}
            />
            <StatCard
              label="File F1"
              value={perIssue.fileF1.toFixed(2)}
              tone={scoreColor(perIssue.fileF1)}
            />
            <StatCard
              label="Similar recall"
              value={perIssue.similarIssueRecall.toFixed(2)}
              tone={scoreColor(perIssue.similarIssueRecall)}
            />
            <StatCard
              label="Trajectory"
              value={String(perIssue.trajectoryLength)}
              hint={`${perIssue.duplicateToolCalls} duplicate calls`}
            />
          </section>
        )}

        <section className="mt-8 rounded-xl border bg-card p-5 ring-1 ring-foreground/[0.04]">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agent output vs. fix PR
          </h2>
          <DiffView actual={actual} expected={expected} />
        </section>

        {perIssue && (
          <p className="mt-3 text-xs text-muted-foreground">
            Category accuracy: {formatPct(perIssue.categoryActual === perIssue.categoryExpected ? 1 : 0)} ·
            scored from latest run {latest?.runId}
          </p>
        )}
      </div>
    </main>
  );
}
