import type { Category } from '@/schemas/v1/triage-card';
import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type DiffTone = 'matched' | 'extra' | 'missed';

const toneCls: Record<DiffTone, string> = {
  matched: 'text-emerald-700 dark:text-emerald-300',
  extra: 'text-amber-700 dark:text-amber-300',
  missed: 'text-red-700 dark:text-red-300',
};

const toneIcon: Record<DiffTone, typeof Check> = {
  matched: Check,
  extra: Plus,
  missed: Minus,
};

function DiffRow({ tone, label }: { tone: DiffTone; label: React.ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <li className={cn('flex items-center gap-2 font-mono text-xs', toneCls[tone])}>
      <Icon className="size-3 shrink-0" />
      <span className="min-w-0 break-all">{label}</span>
    </li>
  );
}

function GroupHeader({ tone, label, count }: { tone: DiffTone; label: string; count: number }) {
  return (
    <div
      className={cn(
        'mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider',
        toneCls[tone],
      )}
    >
      {label}
      <span className="rounded-full bg-current/10 px-1.5 font-mono tabular-nums">{count}</span>
    </div>
  );
}

export function DiffView({
  actual,
  expected,
}: {
  actual: {
    category: Category | null;
    files: string[];
    similarIssues: number[];
  };
  expected: {
    category: Category;
    files: string[];
    similarIssues: number[];
  };
}) {
  const both = new Set(actual.files.filter((p) => expected.files.includes(p)));
  const onlyActual = actual.files.filter((p) => !expected.files.includes(p));
  const onlyExpected = expected.files.filter((p) => !actual.files.includes(p));
  const catMatch = actual.category === expected.category;

  const similar = [...new Set([...actual.similarIssues, ...expected.similarIssues])].sort(
    (a, b) => a - b,
  );

  return (
    <div className="grid gap-6 text-sm md:grid-cols-2">
      <section className="space-y-5">
        {/* Category */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Category
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium',
                catMatch
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-500/12 text-red-700 dark:text-red-300',
              )}
            >
              {actual.category ?? '∅'}
            </span>
            <span className="text-muted-foreground">vs</span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {expected.category}
            </span>
            {catMatch && <Check className="size-4 text-emerald-500" />}
          </div>
        </div>

        {/* Similar issues */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Similar issues
          </h3>
          {similar.length === 0 ? (
            <p className="text-xs text-muted-foreground">None on either side.</p>
          ) : (
            <ul className="space-y-1">
              {similar.map((n) => {
                const inActual = actual.similarIssues.includes(n);
                const inExpected = expected.similarIssues.includes(n);
                const tone: DiffTone =
                  inActual && inExpected ? 'matched' : inActual ? 'extra' : 'missed';
                const note =
                  tone === 'matched'
                    ? 'matched'
                    : tone === 'extra'
                      ? 'only agent'
                      : 'missed';
                return (
                  <DiffRow
                    key={n}
                    tone={tone}
                    label={
                      <>
                        #{n}{' '}
                        <span className="text-muted-foreground/70">· {note}</span>
                      </>
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Files */}
      <section className="space-y-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </h3>

        <div>
          <GroupHeader tone="matched" label="matched" count={both.size} />
          {both.size === 0 ? (
            <p className="text-xs text-muted-foreground/70">—</p>
          ) : (
            <ul className="space-y-1">
              {[...both].sort().map((p) => (
                <DiffRow key={p} tone="matched" label={p} />
              ))}
            </ul>
          )}
        </div>

        <div>
          <GroupHeader tone="extra" label="only in agent" count={onlyActual.length} />
          {onlyActual.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">—</p>
          ) : (
            <ul className="space-y-1">
              {onlyActual.sort().map((p) => (
                <DiffRow key={p} tone="extra" label={p} />
              ))}
            </ul>
          )}
        </div>

        <div>
          <GroupHeader tone="missed" label="only in fix PR" count={onlyExpected.length} />
          {onlyExpected.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">—</p>
          ) : (
            <ul className="space-y-1">
              {onlyExpected.sort().map((p) => (
                <DiffRow key={p} tone="missed" label={p} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
