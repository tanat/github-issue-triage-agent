import { describe, it, expect } from 'vitest';
import { dedupRecentToolCalls, buildDedupReminder } from '@/tools/__helpers__/dedup';
import type { ModelMessage } from 'ai';

type FakeStep = {
  toolCalls: Array<{ toolName: string; input: unknown; dynamic?: boolean }>;
};

function makeStep(toolName: string, input: unknown): FakeStep {
  return { toolCalls: [{ toolName, input }] };
}

const baseMessages: ModelMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'go' },
];

const callDedup = (steps: FakeStep[], messages: ModelMessage[] = baseMessages) =>
  // The helper accepts a wider Tools generic; for tests we just cast the shape.
  (dedupRecentToolCalls as unknown as (opts: {
    steps: FakeStep[];
    stepNumber: number;
    model: unknown;
    messages: ModelMessage[];
  }) => unknown)({ steps, stepNumber: steps.length, model: {}, messages });

describe('dedupRecentToolCalls', () => {
  it('returns undefined when fewer than 2 steps', () => {
    expect(callDedup([])).toBeUndefined();
    expect(callDedup([makeStep('get_issue', { owner: 'a', repo: 'b', number: 1 })])).toBeUndefined();
  });

  it('returns undefined for different tool names', () => {
    expect(
      callDedup([
        makeStep('get_issue', { x: 1 }),
        makeStep('search_issues', { x: 1 }),
      ]),
    ).toBeUndefined();
  });

  it('returns undefined when args differ (even by key order, identity should still differ)', () => {
    const result = callDedup([
      makeStep('search_issues', { query: 'modal', limit: 10 }),
      makeStep('search_issues', { query: 'dialog', limit: 10 }),
    ]);
    expect(result).toBeUndefined();
  });

  it('treats key order as equivalent when args are deeply equal', () => {
    const result = callDedup([
      makeStep('search_issues', { query: 'modal', limit: 10 }),
      makeStep('search_issues', { limit: 10, query: 'modal' }),
    ]) as { messages: ModelMessage[] } | undefined;
    expect(result).toBeDefined();
    expect(result?.messages.at(-1)?.role).toBe('system');
    expect((result?.messages.at(-1)?.content as string).startsWith('[dedup]')).toBe(true);
  });

  it('emits reminder once and not again on subsequent identical pair', () => {
    const messages = [...baseMessages];
    const steps = [
      makeStep('search_issues', { q: 'x' }),
      makeStep('search_issues', { q: 'x' }),
    ];
    const first = callDedup(steps, messages) as { messages: ModelMessage[] } | undefined;
    expect(first).toBeDefined();
    // Simulate that the reminder is now in the message log.
    const remindedMessages = first!.messages;
    const second = callDedup(steps, remindedMessages);
    expect(second).toBeUndefined();
  });

  it('builds a clear reminder string', () => {
    expect(buildDedupReminder('search_issues')).toContain('search_issues');
    expect(buildDedupReminder('search_issues')).toContain('[dedup]');
  });
});
