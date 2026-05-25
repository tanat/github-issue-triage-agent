import type { PrepareStepFunction } from 'ai';
import type { Tools } from '@/tools/registry';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return (
    '{' +
    entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') +
    '}'
  );
}

interface FirstCall {
  name: string;
  argsKey: string;
}

function firstStaticCall(step: { toolCalls: ReadonlyArray<unknown> }): FirstCall | null {
  const call = step.toolCalls?.[0] as
    | { toolName?: string; input?: unknown; dynamic?: boolean }
    | undefined;
  if (!call?.toolName) return null;
  if (call.dynamic) return null;
  return { name: call.toolName, argsKey: stableStringify(call.input ?? null) };
}

const REMINDER_PREFIX = '[dedup]';

export function buildDedupReminder(toolName: string): string {
  return (
    `${REMINDER_PREFIX} You just called \`${toolName}\` twice with identical arguments. ` +
    `Do not call it again with the same input. Either change the arguments meaningfully, ` +
    `pick a different tool, or stop calling tools and write your conclusion.`
  );
}

export const dedupRecentToolCalls: PrepareStepFunction<Tools> = ({ steps, messages }) => {
  if (steps.length < 2) return undefined;
  const last = firstStaticCall(steps.at(-1)!);
  const prev = firstStaticCall(steps.at(-2)!);
  if (!last || !prev) return undefined;
  if (last.name !== prev.name || last.argsKey !== prev.argsKey) return undefined;
  // Already reminded? Don't pile on.
  const alreadyWarned = messages.some(
    (m) =>
      m.role === 'system' &&
      typeof m.content === 'string' &&
      m.content.startsWith(REMINDER_PREFIX),
  );
  if (alreadyWarned) return undefined;
  return {
    messages: [
      ...messages,
      {
        role: 'system',
        content: buildDedupReminder(last.name),
      },
    ],
  };
};
