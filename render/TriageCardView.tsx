'use client';

import { useState } from 'react';
import type { TriageCard, Category, Severity } from '@/schemas/v1/triage-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ArrowUpRight,
  Bug,
  Check,
  ClipboardCopy,
  FileQuestion,
  FileText,
  GitPullRequest,
  Lightbulb,
  Link2,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const categoryMeta: Record<Category, { Icon: LucideIcon; chip: string }> = {
  bug: { Icon: Bug, chip: 'bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300' },
  feature: { Icon: Sparkles, chip: 'bg-blue-500/12 text-blue-700 ring-blue-500/25 dark:text-blue-300' },
  docs: { Icon: FileText, chip: 'bg-purple-500/12 text-purple-700 ring-purple-500/25 dark:text-purple-300' },
  question: { Icon: FileQuestion, chip: 'bg-amber-500/14 text-amber-800 ring-amber-500/25 dark:text-amber-300' },
  duplicate: { Icon: Link2, chip: 'bg-zinc-500/12 text-zinc-700 ring-zinc-500/25 dark:text-zinc-300' },
  wontfix: { Icon: GitPullRequest, chip: 'bg-zinc-500/12 text-zinc-700 ring-zinc-500/25 dark:text-zinc-300' },
  invalid: { Icon: GitPullRequest, chip: 'bg-zinc-500/12 text-zinc-700 ring-zinc-500/25 dark:text-zinc-300' },
  other: { Icon: Lightbulb, chip: 'bg-zinc-500/12 text-zinc-700 ring-zinc-500/25 dark:text-zinc-300' },
};

const severityMeta: Record<Severity, { label: string; dots: number; cls: string }> = {
  critical: { label: 'Critical', dots: 4, cls: 'text-red-600 dark:text-red-300' },
  high: { label: 'High', dots: 3, cls: 'text-orange-600 dark:text-orange-300' },
  medium: { label: 'Medium', dots: 2, cls: 'text-amber-600 dark:text-amber-300' },
  low: { label: 'Low', dots: 1, cls: 'text-emerald-600 dark:text-emerald-300' },
};

const confidenceMeta: Record<'high' | 'medium' | 'low', { filled: number; cls: string }> = {
  high: { filled: 3, cls: 'bg-emerald-500' },
  medium: { filled: 2, cls: 'bg-amber-500' },
  low: { filled: 1, cls: 'bg-zinc-400 dark:bg-zinc-500' },
};

const relevanceMeta: Record<string, string> = {
  exact_duplicate: 'bg-red-500/12 text-red-700 dark:text-red-300',
  closely_related: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  tangentially_related: 'bg-zinc-500/12 text-zinc-600 dark:text-zinc-300',
};

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground/80">
          {count}
        </span>
      )}
    </h3>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[72vh] flex-col overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/[0.04]">
      {children}
    </div>
  );
}

export function TriageCardView({
  card,
  repo,
}: {
  card: TriageCard | null;
  repo?: { owner: string; repo: string };
}) {
  const [copied, setCopied] = useState(false);

  if (!card) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">Triage card</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              The structured, typed result — category, severity, suspected files,
              similar issues and a draft reply — appears here once the agent finishes.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const cat = categoryMeta[card.category];
  const CatIcon = cat.Icon;
  const sev = card.severity ? severityMeta[card.severity] : null;

  return (
    <Shell>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset',
            cat.chip,
          )}
        >
          <CatIcon className="size-3.5" />
          {card.category}
        </span>
        {sev && (
          <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', sev.cls)}>
            <span className="flex items-center gap-0.5" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-3 w-1 rounded-sm',
                    i < sev.dots ? 'bg-current' : 'bg-current/20',
                  )}
                />
              ))}
            </span>
            {sev.label} severity
          </span>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm scroll-slim">
        {/* Reasoning */}
        <section>
          <SectionLabel>
            <Sparkles className="size-3" />
            Reasoning
          </SectionLabel>
          <p className="leading-relaxed text-foreground/90">{card.reasoning}</p>
        </section>

        {/* Suspected files */}
        <section>
          <SectionLabel count={card.suspectedFiles.length}>
            <FileText className="size-3" />
            Suspected files
          </SectionLabel>
          {card.suspectedFiles.length === 0 ? (
            <Empty>No specific files identified.</Empty>
          ) : (
            <ul className="space-y-2">
              {card.suspectedFiles.map((f) => {
                const conf = confidenceMeta[f.confidence];
                return (
                  <li
                    key={f.path}
                    className="rounded-lg border bg-card/60 p-2.5 ring-1 ring-foreground/[0.03]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="min-w-0 truncate font-mono text-[12px] font-medium text-foreground">
                        {f.path}
                      </code>
                      <span
                        className="flex shrink-0 items-center gap-0.5"
                        title={`confidence: ${f.confidence}`}
                      >
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              i < conf.filled ? conf.cls : 'bg-muted-foreground/25',
                            )}
                          />
                        ))}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                      {f.rationale}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Similar issues */}
        <section>
          <SectionLabel count={card.similarIssues.length}>
            <Link2 className="size-3" />
            Similar issues
          </SectionLabel>
          {card.similarIssues.length === 0 ? (
            <Empty>No similar issues found.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {card.similarIssues.map((i) => {
                const href = repo
                  ? `https://github.com/${repo.owner}/${repo.repo}/issues/${i.number}`
                  : undefined;
                const inner = (
                  <>
                    <span className="shrink-0 font-mono text-[12px] font-medium text-primary">
                      #{i.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
                      {i.title}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        relevanceMeta[i.relevance] ?? relevanceMeta.tangentially_related,
                      )}
                    >
                      {i.relevance.replaceAll('_', ' ')}
                    </span>
                    {href && (
                      <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover/issue:text-primary" />
                    )}
                  </>
                );
                return (
                  <li key={i.number}>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="group/issue flex items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-1.5 ring-1 ring-foreground/[0.03] transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-1.5 ring-1 ring-foreground/[0.03]">
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Draft response */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>
              <MessageSquareText className="size-3" />
              Draft response
            </SectionLabel>
            <Button
              size="xs"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(card.draftResponse);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* noop */
                }
              }}
            >
              {copied ? (
                <>
                  <Check className="size-3" /> Copied
                </>
              ) : (
                <>
                  <ClipboardCopy className="size-3" /> Copy
                </>
              )}
            </Button>
          </div>
          <Textarea
            readOnly
            value={card.draftResponse}
            className="min-h-36 resize-none bg-muted/30 text-[12px] leading-relaxed scroll-slim"
          />
        </section>
      </div>
    </Shell>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground">
      {children}
    </p>
  );
}
