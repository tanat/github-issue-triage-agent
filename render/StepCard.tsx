'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface ToolPart {
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function summarize(value: unknown, max = 200): string {
  if (value === undefined) return '';
  let str: string;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    str = String(value);
  }
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export function StepCard({ idx, part }: { idx: number; part: ToolPart }) {
  const [argsOpen, setArgsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const hasInput = part.input !== undefined && part.input !== null;
  const hasOutput = part.output !== undefined;
  const stateLabel =
    part.state === 'output-available'
      ? 'done'
      : part.state === 'input-streaming'
        ? 'calling…'
        : part.state === 'input-available'
          ? 'awaiting result'
          : part.state;

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">{idx}</span>
        <Badge variant="secondary">{part.toolName}</Badge>
        <span className="text-xs text-muted-foreground">{stateLabel}</span>
      </div>
      {hasInput && (
        <div>
          <button
            type="button"
            onClick={() => setArgsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {argsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            args
          </button>
          {argsOpen && (
            <pre className="mt-1 rounded bg-muted p-2 text-xs overflow-auto whitespace-pre-wrap break-words">
              {summarize(part.input, 4000)}
            </pre>
          )}
        </div>
      )}
      {hasOutput && (
        <div>
          <button
            type="button"
            onClick={() => setResultOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {resultOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            result
          </button>
          <pre className="mt-1 rounded bg-muted p-2 text-xs overflow-auto whitespace-pre-wrap break-words">
            {resultOpen ? summarize(part.output, 8000) : summarize(part.output, 200)}
          </pre>
        </div>
      )}
      {part.errorText && (
        <pre className="rounded bg-destructive/10 text-destructive p-2 text-xs whitespace-pre-wrap">
          {part.errorText}
        </pre>
      )}
    </div>
  );
}

export function TextStep({ idx, text }: { idx: number; text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-card/40 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-muted-foreground tabular-nums">{idx}</span>
        <Badge variant="outline">reasoning</Badge>
      </div>
      <pre className="text-xs whitespace-pre-wrap break-words font-sans">{text}</pre>
    </div>
  );
}
