import { describe, it, expect } from 'vitest';
import { parseIssueUrl, InvalidUrlError } from '../parse-url';

describe('parseIssueUrl', () => {
  it('parses canonical issue URL', () => {
    expect(parseIssueUrl('https://github.com/shadcn-ui/ui/issues/4123')).toEqual({
      owner: 'shadcn-ui',
      repo: 'ui',
      number: 4123,
      type: 'issue',
    });
  });

  it('parses canonical pull URL as type=pull', () => {
    expect(parseIssueUrl('https://github.com/shadcn-ui/ui/pull/200')).toEqual({
      owner: 'shadcn-ui',
      repo: 'ui',
      number: 200,
      type: 'pull',
    });
  });

  it('parses owner/repo#N shorthand', () => {
    expect(parseIssueUrl('shadcn-ui/ui#4123')).toEqual({
      owner: 'shadcn-ui',
      repo: 'ui',
      number: 4123,
      type: 'issue',
    });
  });

  it('tolerates trailing slash, fragment, and query', () => {
    expect(parseIssueUrl('https://github.com/vercel/next.js/issues/77777#comment-1')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      number: 77777,
      type: 'issue',
    });
    expect(parseIssueUrl('  https://www.github.com/foo/bar-baz/issues/1/  ')).toEqual({
      owner: 'foo',
      repo: 'bar-baz',
      number: 1,
      type: 'issue',
    });
  });

  it('throws InvalidUrlError on malformed input', () => {
    expect(() => parseIssueUrl('https://example.com/foo/bar/issues/1')).toThrow(InvalidUrlError);
    expect(() => parseIssueUrl('not-a-url')).toThrow(InvalidUrlError);
    expect(() => parseIssueUrl('')).toThrow(InvalidUrlError);
    expect(() => parseIssueUrl('shadcn-ui/ui')).toThrow(InvalidUrlError);
  });
});
