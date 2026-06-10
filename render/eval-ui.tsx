import { cn } from '@/lib/utils';

export function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Map a 0..1 score to a traffic-light text color. */
export function scoreColor(n: number): string {
  if (n >= 0.7) return 'text-emerald-600 dark:text-emerald-400';
  if (n >= 0.4) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function barColor(n: number): string {
  if (n >= 0.7) return 'bg-emerald-500';
  if (n >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

/** A compact inline meter: a value label over a thin progress bar. */
export function MetricBar({
  value,
  format = 'pct',
}: {
  value: number;
  format?: 'pct' | 'ratio';
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="flex min-w-[4.5rem] flex-col gap-1">
      <span className={cn('font-mono text-[12px] tabular-nums', scoreColor(value))}>
        {format === 'pct' ? formatPct(value) : value.toFixed(2)}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', barColor(value))}
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/[0.04]">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
