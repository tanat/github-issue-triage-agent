#!/usr/bin/env tsx
import { getStepsByRun } from '@/agent/log';

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: tsx scripts/inspect-trace.ts <runId>');
  process.exit(1);
}

const rows = getStepsByRun(runId);
if (rows.length === 0) {
  console.error(`No steps found for run ${runId}`);
  process.exit(2);
}

console.log(`Run ${runId} — ${rows.length} step(s)`);
console.log('');
for (const row of rows) {
  const header = `[step ${row.step_idx}] ${row.tool_name ?? '(no tool — final)'} ` +
    `· ${row.latency_ms}ms · in=${row.tokens_in} out=${row.tokens_out}` +
    (row.finish_reason ? ` · finish=${row.finish_reason}` : '');
  console.log(header);
  if (row.tool_args) {
    console.log(`  args: ${row.tool_args}`);
  }
  if (row.tool_result_summary) {
    console.log(`  result[${row.tool_result_size ?? 0}b]: ${row.tool_result_summary}${(row.tool_result_size ?? 0) > 200 ? '…' : ''}`);
  }
  if (row.step_text) {
    const shortened = row.step_text.length > 400
      ? row.step_text.slice(0, 400) + '…'
      : row.step_text;
    console.log(`  text: ${shortened.replace(/\n/g, '\n        ')}`);
  }
  console.log('');
}
