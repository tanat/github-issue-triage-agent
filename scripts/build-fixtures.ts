#!/usr/bin/env tsx
/**
 * Build `fixtures/issues.json`. For each issue ref we:
 *  1. Fetch the issue (REST) for title, labels, body, comments.
 *  2. Use GraphQL `closingIssuesReferences` (on the closing PR) to find which
 *     PR(s) fixed this issue and what files they changed — the eval ground truth.
 *  3. Extract #N refs from the issue body+comments for expectedSimilarIssues.
 *
 * Usage: pnpm build-fixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOctokit, cachedCall } from '@/github/client';
import { parseIssueUrl } from '@/github/parse-url';
import type { Category } from '@/schemas/v1/triage-card';

// Curated 30: verified bugs (with linked PRs giving file ground truth),
// a handful of features, and a couple of questions for category coverage.
const ISSUE_REFS: string[] = [
  // Bugs — closed by a PR (files come from the PR diff)
  'shadcn-ui/ui#10576', // Sidebar OKLCH shadow token wrapping
  'shadcn-ui/ui#10320', // shadcn init silently creates a git commit
  'shadcn-ui/ui#10237', // Unable to apply OKLCH background color
  'shadcn-ui/ui#10164', // CLI should send Accept: application/json headers
  'shadcn-ui/ui#10028', // Setup does not work (tinyexec missing)
  'shadcn-ui/ui#9914',  // --presets incorrectly map to radix
  'shadcn-ui/ui#9753',  // Select (BaseUI) renders value instead of children
  'shadcn-ui/ui#9657',  // Manual installation docs outdated
  'shadcn-ui/ui#9651',  // Accordion disabled style missing (base-ui)
  'shadcn-ui/ui#9635',  // Badge classes order wrong
  'shadcn-ui/ui#9614',  // Base UI Button as link has wrong role
  'shadcn-ui/ui#9595',  // Calendar blocks page returning 404
  'shadcn-ui/ui#9515',  // RTL docs: password reset link wrong direction
  'shadcn-ui/ui#9446',  // Scroll events leak from code snippet blocks
  'shadcn-ui/ui#9428',  // Base UI Button 'use client' breaks RSC imports
  'shadcn-ui/ui#9424',  // Sonner docs has incorrect link
  'shadcn-ui/ui#9403',  // Buttons not working on documentation page
  'shadcn-ui/ui#9337',  // destructive-foreground missing in theming docs
  'shadcn-ui/ui#9278',  // "elative" class error in calendar component
  'shadcn-ui/ui#9222',  // TanStack Form example has poor performance
  'shadcn-ui/ui#9198',  // ALT+D toggles dark/light theme unexpectedly
  'shadcn-ui/ui#9118',  // Resizable component broken
  'shadcn-ui/ui#8432',  // CLI registry removes 'use client' directive
  'shadcn-ui/ui#7695',  // Bun monorepo init error
  'shadcn-ui/ui#7669',  // Support Recharts v3 (feature/chart)
  'shadcn-ui/ui#7166',  // Tooltip has redundant TooltipProvider
  // Registry additions (feature-like, files = registries.json)
  'shadcn-ui/ui#8892',  // Registry Directory: CodeRabbit
  'shadcn-ui/ui#9328',  // Registry Directory: Launch UI
  // Questions / docs (no PR link — test category & draftResponse)
  'shadcn-ui/ui#421',   // react-hook-form: number input
  'shadcn-ui/ui#51',    // How can I extend component props?
];

interface Fixture {
  issueRef: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  labels: string[];
  expectedCategory: Category;
  expectedFiles: string[];
  expectedSimilarIssues: number[];
  linkedPrs: number[];
  fetchedAt: string;
}

const REF_RE = /#(\d{2,})/g;

function inferCategoryFromLabels(labels: string[]): Category {
  const lc = labels.map((l) => l.toLowerCase());
  if (lc.some((l) => l.includes('duplicate'))) return 'duplicate';
  if (lc.some((l) => l.includes('wontfix') || l === "won't fix" || l.includes('not planned'))) return 'wontfix';
  if (lc.some((l) => l === 'invalid')) return 'invalid';
  if (lc.some((l) => l.includes('bug'))) return 'bug';
  if (lc.some((l) => l.includes('enhancement') || l.includes('feature'))) return 'feature';
  if (lc.some((l) => l.includes('docs') || l.includes('documentation'))) return 'docs';
  if (lc.some((l) => l.includes('question') || l.includes('discussion'))) return 'question';
  return 'other';
}

// GraphQL: given an issue number, find PRs that close it and the files they changed.
async function getLinkedPrFiles(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ prs: number[]; files: string[] }> {
  // Walk the issue's timeline looking for ClosedEvent with a PR closer,
  // and CrossReferencedEvent with a PR source. Both can yield linked PRs.
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          timelineItems(first: 20, itemTypes: [CLOSED_EVENT, CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
            nodes {
              __typename
              ... on ClosedEvent {
                closer {
                  __typename
                  ... on PullRequest {
                    number
                    files(first: 50) { nodes { path } }
                  }
                }
              }
              ... on CrossReferencedEvent {
                source {
                  __typename
                  ... on PullRequest {
                    number
                    merged
                    files(first: 50) { nodes { path } }
                  }
                }
              }
              ... on ConnectedEvent {
                subject {
                  __typename
                  ... on PullRequest {
                    number
                    merged
                    files(first: 50) { nodes { path } }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  interface GqlPR { number: number; merged?: boolean; files: { nodes: { path: string }[] } }
  interface GqlNodes {
    __typename: string;
    closer?: { __typename: string } & Partial<GqlPR>;
    source?: { __typename: string } & Partial<GqlPR>;
    subject?: { __typename: string } & Partial<GqlPR>;
  }
  interface GqlResp {
    data: {
      repository: {
        issue: {
          timelineItems: { nodes: GqlNodes[] };
        };
      };
    };
  }

  const resp = await (octokit as unknown as { graphql: (q: string, v: Record<string, unknown>) => Promise<GqlResp['data']> })
    .graphql(query, { owner, repo, number: issueNumber }) as GqlResp['data'];

  const prs = new Set<number>();
  const files = new Set<string>();

  const nodes = resp?.repository?.issue?.timelineItems?.nodes ?? [];
  for (const node of nodes) {
    const pr = node.closer ?? node.source ?? node.subject;
    if (pr?.__typename === 'PullRequest' && pr.number) {
      // For cross-referenced, only include merged PRs to avoid noise
      if (node.__typename === 'CrossReferencedEvent' && pr.merged === false) continue;
      prs.add(pr.number);
      for (const f of pr.files?.nodes ?? []) {
        if (f.path) files.add(f.path);
      }
    }
  }

  return { prs: [...prs].sort((a, b) => a - b), files: [...files].sort() };
}

async function buildOne(ref: string): Promise<Fixture | null> {
  const url = ref.includes('://') ? ref : `https://github.com/${ref.replace('#', '/issues/')}`;
  const parsed = parseIssueUrl(url);
  const octokit = getOctokit();

  let issue;
  try {
    issue = await cachedCall(
      'issues.get',
      { owner: parsed.owner, repo: parsed.repo, number: parsed.number },
      () =>
        octokit.rest.issues.get({
          owner: parsed.owner,
          repo: parsed.repo,
          issue_number: parsed.number,
        }),
    );
  } catch (err) {
    console.warn(`skip ${ref}: ${(err as Error).message}`);
    return null;
  }

  const labels = (issue.data.labels ?? [])
    .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
    .filter(Boolean);

  const { prs: linkedPrsArr, files: changedFiles } = await getLinkedPrFiles(
    octokit,
    parsed.owner,
    parsed.repo,
    parsed.number,
  );

  const similar = new Set<number>();
  const comments = await cachedCall(
    'issues.listComments',
    { owner: parsed.owner, repo: parsed.repo, number: parsed.number },
    () =>
      octokit.rest.issues.listComments({
        owner: parsed.owner,
        repo: parsed.repo,
        issue_number: parsed.number,
        per_page: 100,
      }),
  );
  const allText = [issue.data.body ?? '', ...comments.data.map((c) => c.body ?? '')].join('\n');
  for (const m of allText.matchAll(REF_RE)) {
    const n = Number(m[1]);
    if (n !== parsed.number) similar.add(n);
  }

  return {
    issueRef: `${parsed.owner}/${parsed.repo}#${parsed.number}`,
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    title: issue.data.title,
    state: issue.data.state,
    labels,
    expectedCategory: inferCategoryFromLabels(labels),
    expectedFiles: changedFiles,
    expectedSimilarIssues: [...similar].sort((a, b) => a - b),
    linkedPrs: linkedPrsArr,
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.warn(
      'WARN: GITHUB_TOKEN is not set; you will hit anonymous rate limits quickly.',
    );
  }
  const out: Fixture[] = [];
  for (const ref of ISSUE_REFS) {
    process.stdout.write(`fetching ${ref}… `);
    const fx = await buildOne(ref);
    if (!fx) {
      console.log('FAIL');
      continue;
    }
    console.log(
      `${fx.expectedCategory} · ${fx.expectedFiles.length} expectedFiles · ${fx.expectedSimilarIssues.length} similarRefs`,
    );
    out.push(fx);
  }
  const target = path.join(process.cwd(), 'fixtures', 'issues.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${out.length} fixtures to ${target}`);
  if (out.length < 25) {
    console.warn(
      `WARN: expected ≥25 fixtures, got ${out.length}. Edit ISSUE_REFS in scripts/build-fixtures.ts and rerun.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
