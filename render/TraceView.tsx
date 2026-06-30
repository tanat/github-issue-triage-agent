'use client';

import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from 'ai';
import { Activity, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StepCard, TextStep, type ToolPart } from './StepCard';

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

function extractToolPart(part: AnyPart): ToolPart | null {
  if (part.type === 'dynamic-tool') {
    const p = part as unknown as ToolPart & { state: string };
    return {
      toolName: (part as unknown as { toolName: string }).toolName,
      toolCallId: p.toolCallId,
      state: p.state,
      input: (p as { input?: unknown }).input,
      output: (p as { output?: unknown }).output,
      errorText: (p as { errorText?: string }).errorText,
    };
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const p = part as unknown as ToolPart & { state: string; type: string };
    return {
      toolName: p.type.slice('tool-'.length),
      toolCallId: p.toolCallId,
      state: p.state,
      input: (p as { input?: unknown }).input,
      output: (p as { output?: unknown }).output,
      errorText: (p as { errorText?: string }).errorText,
    };
  }
  return null;
}

function renderableCount(parts: AnyPart[]): number {
  let n = 0;
  for (const part of parts) {
    if (extractToolPart(part)) n++;
    else if (part.type === 'text' && (part as { text: string }).text.trim()) n++;
    else if (part.type === 'reasoning' && (part as { text?: string }).text) n++;
  }
  return n;
}

function Frame({
  count,
  running,
  children,
}: {
  count: number;
  running?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[72vh] flex-col overflow-hidden rounded-xl border bg-card/40 ring-1 ring-foreground/[0.04]">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Activity className="size-3.5" />
          Agent trace
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              <span className="size-1.5 rounded-full bg-primary animate-pulse-dot" />
              streaming
            </span>
          )}
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {count} {count === 1 ? 'step' : 'steps'}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

export function TraceView({
  messages,
  running,
}: {
  messages: UIMessage[];
  running?: boolean;
}) {
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const items: AnyPart[] = assistant?.parts ?? [];
  const count = renderableCount(items);

  if (!assistant && !running) {
    return (
      <Frame count={0}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Activity className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">No run yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Paste a GitHub issue URL above and hit Triage. Each tool call the agent
              makes will stream in here.
            </p>
          </div>
        </div>
      </Frame>
    );
  }

  const showStartup = running && count === 0;

  return (
    <Frame count={count} running={running}>
      <ScrollArea className="min-h-0 flex-1 scroll-slim">
        <div className="space-y-2 p-3">
          {items.map((part, i) => {
            const tool = extractToolPart(part);
            if (tool) {
              return <StepCard key={`${tool.toolCallId}-${i}`} idx={i + 1} part={tool} />;
            }
            if (part.type === 'text' && (part as { text: string }).text.trim()) {
              return <TextStep key={`text-${i}`} idx={i + 1} text={(part as { text: string }).text} />;
            }
            if (part.type === 'reasoning' && (part as { text?: string }).text) {
              return <TextStep key={`reasoning-${i}`} idx={i + 1} text={(part as { text: string }).text} />;
            }
            return null;
          })}

          {showStartup && <StartupSkeleton />}
        </div>
      </ScrollArea>
    </Frame>
  );
}

function StartupSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Connecting to the agent…
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-xl border bg-card/60 p-3"
          style={{ opacity: 1 - i * 0.35 }}
        >
          <span className="size-7 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="h-3 w-28 animate-pulse rounded bg-muted" />
          <span className="ml-auto h-4 w-14 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function extractFinalText(messages: UIMessage[]): string {
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!assistant) return '';
  const parts: AnyPart[] = assistant.parts ?? [];
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n');
}
