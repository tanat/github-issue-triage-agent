'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reasoningMeta, toolMeta } from './tool-meta';

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

/** A short, human-readable summary of the tool input for the card header. */
function inputHint(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
  const hint =
    pick('path') ??
    pick('query') ??
    pick('q') ??
    pick('term') ??
    (typeof o['number'] === 'number' ? `#${o['number']}` : undefined) ??
    pick('owner');
  return hint ? hint : null;
}

type StateKind = 'running' | 'pending' | 'done' | 'error';

function stateInfo(state: string, hasError: boolean): { kind: StateKind; label: string } {
  if (hasError) return { kind: 'error', label: 'error' };
  switch (state) {
    case 'output-available':
      return { kind: 'done', label: 'done' };
    case 'input-streaming':
      return { kind: 'running', label: 'calling' };
    case 'input-available':
      return { kind: 'pending', label: 'awaiting' };
    default:
      return { kind: 'pending', label: state };
  }
}

const stateChip: Record<StateKind, string> = {
  running: 'bg-primary/10 text-primary ring-primary/20',
  pending: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
  done: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  error: 'bg-destructive/10 text-destructive ring-destructive/20',
};

function StatePill({ state, hasError }: { state: string; hasError: boolean }) {
  const { kind, label } = stateInfo(state, hasError);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset',
        stateChip[kind],
      )}
    >
      {kind === 'running' && <Loader2 className="size-2.5 animate-spin" />}
      {kind === 'done' && <span className="size-1.5 rounded-full bg-current" />}
      {kind === 'error' && <CircleAlert className="size-2.5" />}
      {label}
    </span>
  );
}

export function StepCard({ idx, part }: { idx: number; part: ToolPart }) {
  const [argsOpen, setArgsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const hasInput = part.input !== undefined && part.input !== null;
  const hasOutput = part.output !== undefined;
  const meta = toolMeta(part.toolName);
  const Icon = meta.Icon;
  const hint = hasInput ? inputHint(part.input) : null;

  return (
    <div className="animate-step-in group relative rounded-xl border bg-card/80 p-3 shadow-xs ring-1 ring-foreground/[0.04] transition-colors hover:border-foreground/15">
      <div className="flex items-center gap-2.5">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', meta.chip)}>
          <Icon className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <code className="truncate font-mono text-[13px] font-medium text-foreground">
            {meta.label}
          </code>
          {hint && (
            <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {hint}
            </code>
          )}
        </div>
        <StatePill state={part.state} hasError={!!part.errorText} />
        <span className="ml-0.5 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {String(idx).padStart(2, '0')}
        </span>
      </div>

      {(hasInput || hasOutput || part.errorText) && (
        <div className="mt-2.5 space-y-2 pl-9.5">
          {hasInput && (
            <Disclosure
              open={argsOpen}
              onToggle={() => setArgsOpen((v) => !v)}
              label="arguments"
            >
              <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg bg-muted/70 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words scroll-slim">
                {summarize(part.input, 4000)}
              </pre>
            </Disclosure>
          )}

          {hasOutput && (
            <Disclosure
              open={resultOpen}
              onToggle={() => setResultOpen((v) => !v)}
              label="result"
            >
              <pre
                className={cn(
                  'mt-1.5 overflow-auto rounded-lg bg-muted/70 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words scroll-slim',
                  resultOpen ? 'max-h-80' : 'max-h-20',
                )}
              >
                {resultOpen ? summarize(part.output, 8000) : summarize(part.output, 200)}
              </pre>
            </Disclosure>
          )}

          {part.errorText && (
            <pre className="rounded-lg bg-destructive/10 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-destructive ring-1 ring-inset ring-destructive/20">
              {part.errorText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 rounded text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </button>
      {open && children}
    </div>
  );
}

export function TextStep({ idx, text }: { idx: number; text: string }) {
  const Icon = reasoningMeta.Icon;
  return (
    <div className="animate-step-in rounded-xl border border-dashed border-primary/25 bg-primary/[0.035] p-3">
      <div className="mb-1.5 flex items-center gap-2.5">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', reasoningMeta.chip)}>
          <Icon className="size-3.5" />
        </span>
        <span className="text-[13px] font-medium text-primary">Reasoning</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {String(idx).padStart(2, '0')}
        </span>
      </div>
      <p className="pl-9.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
        {text}
      </p>
    </div>
  );
}
