'use client';

import { useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  ArrowRight,
  CircleAlert,
  GitBranch,
  Github,
  LineChart,
  Loader2,
} from 'lucide-react';
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

  const parsed = useMemo(() => {
    try {
      const p = parseIssueUrl(url);
      return { owner: p.owner, repo: p.repo, number: p.number };
    } catch {
      return undefined;
    }
  }, [url]);
  const repo = parsed ? { owner: parsed.owner, repo: parsed.repo } : undefined;

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
    <main className="app-aurora flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-6 sm:px-8 sm:py-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
                <Github className="size-5" />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">
                Issue Triage <span className="text-muted-foreground">Agent</span>
              </h1>
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              Paste a GitHub issue URL. An agent investigates it with repo tools and
              returns a typed triage card — with its sources.
            </p>
          </div>
          <a
            href="/eval"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card/60 px-3 py-1.5 text-sm font-medium text-muted-foreground ring-1 ring-foreground/[0.04] transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <LineChart className="size-4" />
            Eval dashboard
            <ArrowRight className="size-3.5" />
          </a>
        </header>

        {/* Command bar */}
        <form
          onSubmit={onSubmit}
          className="rounded-xl border bg-card/70 p-2.5 shadow-sm ring-1 ring-foreground/[0.04] backdrop-blur-sm"
        >
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-lg border bg-background px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
              <Github className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/issues/N"
                disabled={running}
                spellCheck={false}
                className="h-9 border-0 bg-transparent px-0 font-mono text-[13px] focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as ModelKey)}
                  disabled={running}
                  aria-label="Model"
                  className="h-9 cursor-pointer appearance-none rounded-lg border border-input bg-background pl-3 pr-8 text-[13px] font-medium outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {MODEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ArrowRight className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 rotate-90 text-muted-foreground" />
              </div>
              <Button type="submit" size="lg" disabled={running || !url.trim()} className="h-9 px-4">
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Running
                  </>
                ) : (
                  <>
                    Triage
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Parsed-repo preview */}
          <div className="mt-2 flex items-center gap-2 px-1 text-xs">
            {parsed ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <GitBranch className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <code className="font-mono text-foreground">
                  {parsed.owner}/{parsed.repo}
                </code>
                <span className="text-muted-foreground/60">·</span>
                <span className="font-mono">issue #{parsed.number}</span>
              </span>
            ) : url.trim() ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <CircleAlert className="size-3.5" />
                Not a recognizable GitHub issue URL yet.
              </span>
            ) : (
              <span className="text-muted-foreground/70">
                Expected format: github.com/owner/repo/issues/N
              </span>
            )}
          </div>
        </form>

        {/* Error banner */}
        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-sm text-destructive ring-1 ring-inset ring-destructive/10">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Triage run failed</p>
              <p className="mt-0.5 text-destructive/85">{error.message}</p>
            </div>
          </div>
        )}

        {/* Panels */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section className="space-y-2">
            <TraceView messages={messages} running={running} />
          </section>
          <section className="space-y-2">
            <TriageCardView card={card} repo={repo} />
          </section>
        </div>
      </div>
    </main>
  );
}
