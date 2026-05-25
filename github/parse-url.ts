import type { ParsedIssueUrl } from '@/schemas/v1/url';

export class InvalidUrlError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid GitHub issue URL ${JSON.stringify(input)}: ${reason}`);
    this.name = 'InvalidUrlError';
  }
}

const SLUG = '[A-Za-z0-9._-]+';

const FULL_URL = new RegExp(
  `^https?:\\/\\/(?:www\\.)?github\\.com\\/(${SLUG})\\/(${SLUG})\\/(issues|pull|pulls)\\/(\\d+)(?:[\\/#?].*)?$`,
);

const SHORTHAND = new RegExp(`^(${SLUG})\\/(${SLUG})#(\\d+)$`);

export function parseIssueUrl(input: string): ParsedIssueUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidUrlError(input, 'empty input');

  const full = FULL_URL.exec(trimmed);
  if (full) {
    const [, owner, repo, kind, num] = full;
    return {
      owner,
      repo,
      number: Number(num),
      type: kind === 'issues' ? 'issue' : 'pull',
    };
  }

  const short = SHORTHAND.exec(trimmed);
  if (short) {
    const [, owner, repo, num] = short;
    return { owner, repo, number: Number(num), type: 'issue' };
  }

  throw new InvalidUrlError(
    input,
    'expected https://github.com/{owner}/{repo}/issues/{n} or {owner}/{repo}#{n}',
  );
}
