import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { PROMPT_VERSION } from './system-prompt';

const DB_PATH = path.join(process.cwd(), 'logs', 'steps.sqlite');
export const SCHEMA_VERSION = 'v1.0.0';

let dbInstance: Database.Database | null = null;
let initialized = false;

function isWritable(): boolean {
  return !process.env.VERCEL;
}

function db(): Database.Database | null {
  if (!isWritable()) return null;
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  initDb();
  return dbInstance;
}

export function initDb(): void {
  if (!isWritable()) return;
  if (initialized) return;
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
  }
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_idx INTEGER NOT NULL,
      ts TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      tool_result_size INTEGER,
      tool_result_summary TEXT,
      step_text TEXT,
      finish_reason TEXT,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_steps_tool ON steps(tool_name);
  `);
  initialized = true;
}

export interface LogStepEntry {
  runId: string;
  stepIdx: number;
  model: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
  stepText: string | null;
  finishReason: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export function logStep(entry: LogStepEntry): void {
  const handle = db();
  if (!handle) return;
  const argsJson = entry.toolArgs ? JSON.stringify(entry.toolArgs) : null;
  const resultJson = entry.toolResult !== undefined ? JSON.stringify(entry.toolResult) : null;
  const summary =
    resultJson === null ? null : resultJson.slice(0, 200);
  handle
    .prepare(
      `INSERT INTO steps (
        run_id, step_idx, ts, schema_version, prompt_version, model,
        tool_name, tool_args, tool_result_size, tool_result_summary,
        step_text, finish_reason, tokens_in, tokens_out, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.runId,
      entry.stepIdx,
      new Date().toISOString(),
      SCHEMA_VERSION,
      PROMPT_VERSION,
      entry.model,
      entry.toolName,
      argsJson,
      resultJson === null ? null : Buffer.byteLength(resultJson, 'utf8'),
      summary,
      entry.stepText,
      entry.finishReason,
      entry.tokensIn,
      entry.tokensOut,
      entry.latencyMs,
    );
}

export interface StepRow {
  id: number;
  run_id: string;
  step_idx: number;
  ts: string;
  schema_version: string;
  prompt_version: string;
  model: string;
  tool_name: string | null;
  tool_args: string | null;
  tool_result_size: number | null;
  tool_result_summary: string | null;
  step_text: string | null;
  finish_reason: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

export function getStepsByRun(runId: string): StepRow[] {
  const handle = db();
  if (!handle) return [];
  return handle
    .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY step_idx ASC')
    .all(runId) as StepRow[];
}
