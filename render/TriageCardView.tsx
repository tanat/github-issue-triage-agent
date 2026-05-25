'use client';

import { useState } from 'react';
import type { TriageCard, Category, Severity } from '@/schemas/v1/triage-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const categoryColor: Record<Category, string> = {
  bug: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200',
  feature: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200',
  docs: 'bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-200',
  question: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  duplicate: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
  wontfix: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
  invalid: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
  other: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
};

const severityColor: Record<Severity, string> = {
  critical: 'border-red-600 text-red-700 dark:text-red-300',
  high: 'border-orange-600 text-orange-700 dark:text-orange-300',
  medium: 'border-amber-600 text-amber-700 dark:text-amber-300',
  low: 'border-zinc-500 text-zinc-700 dark:text-zinc-300',
};

const confidenceLabel: Record<'high' | 'medium' | 'low', string> = {
  high: '●●●',
  medium: '●●○',
  low: '●○○',
};

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
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Triage card</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The structured TriageCard will appear here once the agent finishes.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <span className={`px-2 py-0.5 rounded-md text-xs uppercase tracking-wide ${categoryColor[card.category]}`}>
            {card.category}
          </span>
          {card.severity ? (
            <Badge variant="outline" className={severityColor[card.severity]}>
              {card.severity}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <section>
          <h3 className="text-xs uppercase text-muted-foreground mb-1">Reasoning</h3>
          <p>{card.reasoning}</p>
        </section>

        <section>
          <h3 className="text-xs uppercase text-muted-foreground mb-1">
            Suspected files ({card.suspectedFiles.length})
          </h3>
          {card.suspectedFiles.length === 0 ? (
            <p className="text-muted-foreground">No specific files identified.</p>
          ) : (
            <ul className="space-y-1.5">
              {card.suspectedFiles.map((f) => (
                <li key={f.path} className="flex items-start gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground" title={`confidence: ${f.confidence}`}>
                    {confidenceLabel[f.confidence]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <code className="text-xs font-mono break-all">{f.path}</code>
                    <p className="text-xs text-muted-foreground">{f.rationale}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-xs uppercase text-muted-foreground mb-1">
            Similar issues ({card.similarIssues.length})
          </h3>
          {card.similarIssues.length === 0 ? (
            <p className="text-muted-foreground">No similar issues found.</p>
          ) : (
            <ul className="space-y-1">
              {card.similarIssues.map((i) => {
                const href = repo
                  ? `https://github.com/${repo.owner}/${repo.repo}/issues/${i.number}`
                  : undefined;
                return (
                  <li key={i.number} className="flex items-baseline gap-2">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono text-blue-600 dark:text-blue-300 hover:underline"
                      >
                        #{i.number}
                      </a>
                    ) : (
                      <span className="text-xs font-mono">#{i.number}</span>
                    )}
                    <span className="text-xs flex-1 truncate">{i.title}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{i.relevance.replaceAll('_', ' ')}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs uppercase text-muted-foreground">Draft response</h3>
            <Button
              size="sm"
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
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Textarea
            readOnly
            value={card.draftResponse}
            className="min-h-32 font-mono text-xs"
          />
        </section>
      </CardContent>
    </Card>
  );
}
