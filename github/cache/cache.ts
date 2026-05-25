import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const TTL_MS = 5 * 60 * 1000;
const DB_PATH = path.join(process.cwd(), 'logs', 'cache.sqlite');

let dbInstance: Database.Database | null = null;
let initialized = false;

function isWritableEnv(): boolean {
  // Vercel filesystem is read-only; in production we skip the cache.
  if (process.env.VERCEL) return false;
  return process.env.NODE_ENV !== 'production';
}

function getDb(): Database.Database | null {
  if (!isWritableEnv()) return null;
  if (dbInstance) return dbInstance;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    if (!initialized) {
      dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          method TEXT NOT NULL,
          args_hash TEXT NOT NULL,
          result_json TEXT NOT NULL,
          ts TEXT NOT NULL,
          PRIMARY KEY (method, args_hash)
        );
      `);
      initialized = true;
    }
    return dbInstance;
  } catch {
    return null;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

function hashArgs(method: string, args: unknown): string {
  const payload = method + '|' + stableStringify(args);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function getCached<T>(method: string, args: unknown): T | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare('SELECT result_json, ts FROM cache WHERE method = ? AND args_hash = ?')
    .get(method, hashArgs(method, args)) as { result_json: string; ts: string } | undefined;
  if (!row) return null;
  if (Date.now() - new Date(row.ts).getTime() > TTL_MS) return null;
  return JSON.parse(row.result_json) as T;
}

export function setCached(method: string, args: unknown, result: unknown): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT OR REPLACE INTO cache (method, args_hash, result_json, ts) VALUES (?, ?, ?, ?)',
  ).run(method, hashArgs(method, args), JSON.stringify(result), new Date().toISOString());
}

export async function withCache<T>(
  method: string,
  args: unknown,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = getCached<T>(method, args);
  if (cached !== null) return cached;
  const result = await loader();
  setCached(method, args, result);
  return result;
}
