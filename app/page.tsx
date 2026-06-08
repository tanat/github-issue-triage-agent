'use client';

import { useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TraceView, extractFinalText } from '@/render/TraceView';
import { TriageCardView } from '@/render/TriageCardView';
import { extractTriageCard } from '@/schemas/v1/triage-card';
import { parseIssueUrl } from '@/github/parse-url';
import type { ModelKey } from '@/agent/run';

const MODEL_OPTIONS: { value: ModelKey; label: string }[] = [
  { value: 'sonnet', label: 'Claude Sonnet 4.6' },
  { value: 'gemini-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gpt-4o', label: 'GPT-4o' },
];

const transport = new DefaultChatTransport({ api: '/api/triage' });

export default function Home() {
  const [url, setUrl] = useState('https://github.com/shadcn-ui/ui/issues/9198');
  const [model, setModel] = useState<ModelKey>('gemini-flash');
  const { messages, sendMessage, status, error } = useChat({ transport });

  const repo = useMemo(() => {
    try {
      const parsed = parseIssueUrl(url);
      return { owner: parsed.owner, repo: parsed.repo };
    } catch {
      return undefined;
    }
  }, [url]);

  const card = useMemo(() => extractTriageCard(extractFinalText(messages)), [messages]);
  const running = status === 'streaming' || status === 'submitted';

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    void sendMessage(
      { text: `Triage this issue: ${url}` },
      { body: { issueUrl: url, model } },
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">GitHub Issue Triage</h1>
        <a
          href="/eval"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          eval dashboard →
        </a>
      </header>

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/issues/N"
          disabled={running}
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ModelKey)}
          disabled={running}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
        >
          {MODEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button type="submit" disabled={running || !url}>
          {running ? 'Running…' : 'Triage'}
        </Button>
      </form>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error.message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Trace</h2>
          <TraceView messages={messages} />
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Triage card</h2>
          <TriageCardView card={card} repo={repo} />
        </section>
      </div>
    </main>
  );
}
