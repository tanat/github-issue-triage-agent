import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BarChart3, Crown, Trophy } from 'lucide-react';
import type { PerIssueScore, AggregateScore } from '@/evals/score';
import { MetricBar, StatCard, formatPct, scoreColor } from '@/render/eval-ui';
import { cn } from '@/lib/utils';

interface ResultRow {
  runId: string;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  perIssue: PerIssueScore[];
  aggregate: AggregateScore;
}

function loadResults(): ResultRow[] {
  const file = path.join(process.cwd(), 'evals', 'results.json');
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-aurora flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 sm:px-8 sm:py-8">{children}</div>
    </main>
  );
}

export default function EvalDashboardPage() {
  const results = loadResults();

  if (results.length === 0) {
    return (
      <Shell>
        <PageHeader />
        <div className="mt-8 rounded-xl border border-dashed bg-card/50 p-10 text-center">
          <BarChart3 className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No eval runs yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">pnpm eval</code>{' '}
            after populating{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              fixtures/issues.json
            </code>
            .
          </p>
        </div>
      </Shell>
    );
  }

  const latest = results[results.length - 1];
  const scores = results.map((r) => r.aggregate.weightedAggregate);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const bestRunId = results.find((r) => r.aggregate.weightedAggregate === best)?.runId;
  const worstRunId =
    results.length > 1
      ? [...results].reverse().find((r) => r.aggregate.weightedAggregate === worst)?.runId
      : undefined;

  return (
    <Shell>
      <PageHeader />

      {/* Latest-run summary stats */}
      <section className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Latest run · {latest.model}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Aggregate"
            value={formatPct(latest.aggregate.weightedAggregate)}
            tone={scoreColor(latest.aggregate.weightedAggregate)}
            hint={`${latest.aggregate.count} issues`}
          />
          <StatCard
            label="Category acc."
            value={formatPct(latest.aggregate.categoryAccuracy)}
            tone={scoreColor(latest.aggregate.categoryAccuracy)}
          />
          <StatCard
            label="File F1"
            value={formatPct(latest.aggregate.fileF1)}
            tone={scoreColor(latest.aggregate.fileF1)}
          />
          <StatCard
            label="Similar recall"
            value={formatPct(latest.aggregate.similarIssueRecall)}
            tone={scoreColor(latest.aggregate.similarIssueRecall)}
          />
        </div>
      </section>

      {/* Aggregate per run */}
      <section className="mt-8">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          All runs
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card ring-1 ring-foreground/[0.04]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <Th className="pl-4">run</Th>
                <Th>model</Th>
                <Th className="text-right">n</Th>
                <Th className="text-right">category</Th>
                <Th className="text-right">file F1</Th>
                <Th className="text-right">similar</Th>
                <Th className="text-right">steps</Th>
                <Th className="text-right">dup</Th>
                <Th className="text-right">complete</Th>
                <Th className="pr-4 text-right">aggregate</Th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const isBest = r.runId === bestRunId;
                const isWorst = !isBest && r.runId === worstRunId;
                return (
                  <tr
                    key={r.runId}
                    className={cn(
                      'border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30',
                      isBest && 'bg-emerald-500/[0.07]',
                      isWorst && 'bg-red-500/[0.05]',
                    )}
                  >
                    <Td className="pl-4">
                      <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        {isBest && <Crown className="size-3.5 text-emerald-500" />}
                        {r.runId}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-medium">{r.model}</span>
                    </Td>
                    <NumTd>{r.aggregate.count}</NumTd>
                    <PctTd value={r.aggregate.categoryAccuracy} />
                    <PctTd value={r.aggregate.fileF1} />
                    <PctTd value={r.aggregate.similarIssueRecall} />
                    <NumTd>{r.aggregate.averageTrajectoryLength.toFixed(1)}</NumTd>
                    <NumTd>{formatPct(r.aggregate.duplicateCallRate)}</NumTd>
                    <PctTd value={r.aggregate.completeness} />
                    <Td className="pr-4 text-right">
                      <span
                        className={cn(
                          'font-mono text-sm font-semibold tabular-nums',
                          scoreColor(r.aggregate.weightedAggregate),
                        )}
                      >
                        {formatPct(r.aggregate.weightedAggregate)}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-issue */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Trophy className="size-3.5" />
          Per-issue · {latest.model} (best first)
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card ring-1 ring-foreground/[0.04]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <Th className="pl-4">issue</Th>
                <Th>category</Th>
                <Th className="text-right">file F1</Th>
                <Th className="text-right">similar</Th>
                <Th className="text-right">steps</Th>
                <Th className="text-right">dup</Th>
                <Th className="text-right">aggregate</Th>
                <Th className="pr-4" />
              </tr>
            </thead>
            <tbody>
              {[...latest.perIssue]
                .sort((a, b) => b.aggregate - a.aggregate)
                .map((p) => {
                  const catMatch = p.categoryActual === p.categoryExpected;
                  return (
                    <tr
                      key={p.issueRef}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
                    >
                      <Td className="pl-4">
                        <span className="font-mono text-xs">{p.issueRef}</span>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 font-medium',
                              catMatch
                                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                : 'bg-red-500/12 text-red-700 dark:text-red-300',
                            )}
                          >
                            {p.categoryActual ?? '∅'}
                          </span>
                          {!catMatch && (
                            <span className="text-muted-foreground">
                              → {p.categoryExpected}
                            </span>
                          )}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <div className="ml-auto w-fit">
                          <MetricBar value={p.fileF1} format="ratio" />
                        </div>
                      </Td>
                      <Td className="text-right">
                        <div className="ml-auto w-fit">
                          <MetricBar value={p.similarIssueRecall} format="ratio" />
                        </div>
                      </Td>
                      <NumTd>{p.trajectoryLength}</NumTd>
                      <NumTd>{p.duplicateToolCalls}</NumTd>
                      <Td className="text-right">
                        <span
                          className={cn(
                            'font-mono text-sm font-semibold tabular-nums',
                            scoreColor(p.aggregate),
                          )}
                        >
                          {p.aggregate.toFixed(2)}
                        </span>
                      </Td>
                      <Td className="pr-4 text-right">
                        <Link
                          href={`/eval/${encodeURIComponent(p.issueRef)}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          detail
                          <ArrowRight className="size-3" />
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background">
            <BarChart3 className="size-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Eval dashboard</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Offline scores per model and per fixture issue.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg border bg-card/60 px-3 py-1.5 text-sm font-medium text-muted-foreground ring-1 ring-foreground/[0.04] transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-3.5" />
        Back to triage
      </Link>
    </header>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2.5 font-medium', className)}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5', className)}>{children}</td>;
}

function NumTd({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{children}</td>;
}

function PctTd({ value }: { value: number }) {
  return (
    <td className="px-3 py-2.5 text-right">
      <span className={cn('font-mono text-xs tabular-nums', scoreColor(value))}>
        {formatPct(value)}
      </span>
    </td>
  );
}
