#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { runTriageOnce, MODEL_IDS, type ModelKey } from '@/agent/run';
import { aggregateScores, scoreIssue, type ExpectedFixture, type PerIssueScore } from '@/evals/score';
import type { Category } from '@/schemas/v1/triage-card';
import { PROMPT_VERSION } from '@/agent/system-prompt';
import { SCHEMA_VERSION } from '@/schemas/v1/triage-card';
import { initTelemetry, flushTelemetry } from '@/evals/telemetry';

interface Fixture extends ExpectedFixture {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  labels: string[];
  expectedCategory: Category;
}

interface ResultRow {
  runId: string;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  perIssue: PerIssueScore[];
  aggregate: ReturnType<typeof aggregateScores>;
}

function parseModelArg(): ModelKey {
  const arg = process.argv.find((a) => a.startsWith('--model='));
  if (!arg) return 'sonnet';
  const v = arg.split('=')[1];
  if (v in MODEL_IDS) return v as ModelKey;
  throw new Error(`Unknown model: ${v}. Valid choices: ${Object.keys(MODEL_IDS).join(', ')}`);
}

async function main() {
  initTelemetry();
  const modelKey = parseModelArg();
  const fixturesPath = path.join(process.cwd(), 'fixtures', 'issues.json');
  if (!fs.existsSync(fixturesPath)) {
    console.error(`No fixtures at ${fixturesPath}. Run \`pnpm build-fixtures\` first.`);
    process.exit(2);
  }
  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  if (fixtures.length === 0) {
    console.error('fixtures/issues.json is empty. Populate it via `pnpm build-fixtures`.');
    process.exit(2);
  }

  const perIssue: PerIssueScore[] = [];
  const startedAt = new Date().toISOString();

  for (const fx of fixtures) {
    const url = `https://github.com/${fx.owner}/${fx.repo}/issues/${fx.number}`;
    process.stdout.write(`triaging ${fx.issueRef} (${modelKey})… `);
    try {
      const result = await runTriageOnce({
        issueUrl: url,
        parsedSummary: `(Parsed: owner=${fx.owner}, repo=${fx.repo}, number=${fx.number}.)`,
        modelKey,
      });
      const per = scoreIssue(
        { card: result.card, steps: result.steps },
        {
          issueRef: fx.issueRef,
          expectedCategory: fx.expectedCategory,
          expectedFiles: fx.expectedFiles,
          expectedSimilarIssues: fx.expectedSimilarIssues,
        },
      );
      perIssue.push(per);
      console.log(
        `cat=${per.categoryActual ?? 'null'}/${per.categoryExpected} ` +
          `f1=${per.fileF1} sim=${per.similarIssueRecall} ` +
          `steps=${per.trajectoryLength} agg=${per.aggregate}`,
      );
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

  const resultsPath = path.join(process.cwd(), 'evals', 'results.json');
  let history: ResultRow[] = [];
  if (fs.existsSync(resultsPath)) {
    try {
      history = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }
  history.push(row);
  fs.writeFileSync(resultsPath, JSON.stringify(history, null, 2));

  console.log('\nAggregate:');
  console.log(JSON.stringify(row.aggregate, null, 2));
  console.log(`\nWrote run to ${resultsPath} (${history.length} total entries).`);
}

main()
  .then(() => flushTelemetry())
  .catch(async (err) => {
    console.error(err);
    await flushTelemetry();
    process.exit(1);
  });
