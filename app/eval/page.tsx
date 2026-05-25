import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import type { PerIssueScore, AggregateScore } from '@/evals/score';

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

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default function EvalDashboardPage() {
  const results = loadResults();

  if (results.length === 0) {
    return (
      <main className="mx-auto max-w-5xl p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Eval dashboard</h1>
        <p className="text-sm text-muted-foreground">
          No eval runs yet. Run <code className="text-xs bg-muted px-1 rounded">pnpm eval</code> after
          populating <code className="text-xs bg-muted px-1 rounded">fixtures/issues.json</code>.
        </p>
        <Link href="/" className="text-sm text-blue-600 underline">← back to triage</Link>
      </main>
    );
  }

  const latest = results[results.length - 1];

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Eval dashboard</h1>
        <Link href="/" className="text-sm text-blue-600 underline">← back to triage</Link>
      </header>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Aggregate metrics</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">runId</th>
              <th className="py-2 pr-4">model</th>
              <th className="py-2 pr-4">n</th>
              <th className="py-2 pr-4">category</th>
              <th className="py-2 pr-4">file F1</th>
              <th className="py-2 pr-4">similar</th>
              <th className="py-2 pr-4">avg steps</th>
              <th className="py-2 pr-4">dup rate</th>
              <th className="py-2 pr-4">complete</th>
              <th className="py-2 pr-4">aggregate</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.runId} className="border-t">
                <td className="py-2 pr-4 font-mono text-xs">{r.runId}</td>
                <td className="py-2 pr-4">{r.model}</td>
                <td className="py-2 pr-4">{r.aggregate.count}</td>
                <td className="py-2 pr-4">{formatPct(r.aggregate.categoryAccuracy)}</td>
                <td className="py-2 pr-4">{formatPct(r.aggregate.fileF1)}</td>
                <td className="py-2 pr-4">{formatPct(r.aggregate.similarIssueRecall)}</td>
                <td className="py-2 pr-4">{r.aggregate.averageTrajectoryLength.toFixed(1)}</td>
                <td className="py-2 pr-4">{formatPct(r.aggregate.duplicateCallRate)}</td>
                <td className="py-2 pr-4">{formatPct(r.aggregate.completeness)}</td>
                <td className="py-2 pr-4 font-medium">{formatPct(r.aggregate.weightedAggregate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Latest run · per-issue ({latest.model})
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">issue</th>
              <th className="py-2 pr-4">cat actual / expected</th>
              <th className="py-2 pr-4">file F1</th>
              <th className="py-2 pr-4">similar</th>
              <th className="py-2 pr-4">steps</th>
              <th className="py-2 pr-4">dup</th>
              <th className="py-2 pr-4">aggregate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...latest.perIssue]
              .sort((a, b) => b.aggregate - a.aggregate)
              .map((p) => (
                <tr key={p.issueRef} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{p.issueRef}</td>
                  <td className="py-2 pr-4">
                    {p.categoryActual ?? '∅'} / {p.categoryExpected}
                  </td>
                  <td className="py-2 pr-4">{p.fileF1.toFixed(2)}</td>
                  <td className="py-2 pr-4">{p.similarIssueRecall.toFixed(2)}</td>
                  <td className="py-2 pr-4">{p.trajectoryLength}</td>
                  <td className="py-2 pr-4">{p.duplicateToolCalls}</td>
                  <td className="py-2 pr-4 font-medium">{p.aggregate.toFixed(2)}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/eval/${encodeURIComponent(p.issueRef)}`}
                      className="text-xs text-blue-600 underline"
                    >
                      detail →
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
