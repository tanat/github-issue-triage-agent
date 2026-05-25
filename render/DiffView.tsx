import type { Category } from '@/schemas/v1/triage-card';
import { Badge } from '@/components/ui/badge';

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

  return (
    <div className="grid gap-6 md:grid-cols-2 text-sm">
      <section className="space-y-3">
        <h3 className="text-xs uppercase text-muted-foreground">Category</h3>
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">actual</div>
            <Badge variant={actual.category === expected.category ? 'default' : 'destructive'}>
              {actual.category ?? '∅'}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">expected</div>
            <Badge variant="secondary">{expected.category}</Badge>
          </div>
        </div>

        <h3 className="text-xs uppercase text-muted-foreground mt-4">Similar issues</h3>
        <ul className="space-y-1 text-xs">
          {[...new Set([...actual.similarIssues, ...expected.similarIssues])].sort((a, b) => a - b).map((n) => {
            const inActual = actual.similarIssues.includes(n);
            const inExpected = expected.similarIssues.includes(n);
            const cls = inActual && inExpected
              ? 'text-emerald-700 dark:text-emerald-300'
              : inActual
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-red-700 dark:text-red-300';
            return (
              <li key={n} className={cls}>
                #{n} {inActual && inExpected ? '·  matched' : inActual ? '·  only actual' : '·  missed'}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase text-muted-foreground">Files</h3>
        <div>
          <div className="text-[10px] uppercase text-emerald-700 dark:text-emerald-300">matched ({both.size})</div>
          <ul className="text-xs font-mono">
            {[...both].sort().map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300">only in agent ({onlyActual.length})</div>
          <ul className="text-xs font-mono">
            {onlyActual.sort().map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase text-red-700 dark:text-red-300">only in fix PR ({onlyExpected.length})</div>
          <ul className="text-xs font-mono">
            {onlyExpected.sort().map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
