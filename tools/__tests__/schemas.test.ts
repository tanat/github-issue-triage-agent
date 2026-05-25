import { describe, it, expect } from 'vitest';
import { GetIssueInput } from '@/schemas/v1/tools/get-issue';
import { SearchIssuesInput } from '@/schemas/v1/tools/search-issues';
import { SearchCodeInput } from '@/schemas/v1/tools/search-code';
import { ReadFileInput } from '@/schemas/v1/tools/read-file';
import { ListDirectoryInput } from '@/schemas/v1/tools/list-directory';
import { GetFileHistoryInput } from '@/schemas/v1/tools/get-file-history';

describe('tool input schemas', () => {
  it('get_issue accepts owner/repo/number', () => {
    expect(
      GetIssueInput.parse({ owner: 'shadcn-ui', repo: 'ui', number: 4123 }),
    ).toEqual({ owner: 'shadcn-ui', repo: 'ui', number: 4123 });
  });

  it('get_issue rejects negative numbers', () => {
    expect(() =>
      GetIssueInput.parse({ owner: 'a', repo: 'b', number: -1 }),
    ).toThrow();
  });

  it('search_issues defaults state and limit', () => {
    const v = SearchIssuesInput.parse({ owner: 'a', repo: 'b', query: 'foo' });
    expect(v.state).toBe('all');
    expect(v.limit).toBe(10);
  });

  it('search_issues caps limit at 20', () => {
    expect(() =>
      SearchIssuesInput.parse({ owner: 'a', repo: 'b', query: 'x', limit: 100 }),
    ).toThrow();
  });

  it('search_code accepts optional fileExtension', () => {
    expect(
      SearchCodeInput.parse({ owner: 'a', repo: 'b', query: 'foo', fileExtension: 'tsx' }).fileExtension,
    ).toBe('tsx');
    expect(
      SearchCodeInput.parse({ owner: 'a', repo: 'b', query: 'foo' }).fileExtension,
    ).toBeUndefined();
  });

  it('read_file requires path; ref is optional', () => {
    expect(() => ReadFileInput.parse({ owner: 'a', repo: 'b' })).toThrow();
    const v = ReadFileInput.parse({ owner: 'a', repo: 'b', path: 'x.ts' });
    expect(v.ref).toBeUndefined();
  });

  it('list_directory defaults path to ""', () => {
    expect(ListDirectoryInput.parse({ owner: 'a', repo: 'b' }).path).toBe('');
  });

  it('get_file_history requires path and defaults limit', () => {
    expect(
      GetFileHistoryInput.parse({ owner: 'a', repo: 'b', path: 'x.ts' }).limit,
    ).toBe(10);
    expect(() =>
      GetFileHistoryInput.parse({ owner: 'a', repo: 'b', limit: 5 }),
    ).toThrow();
  });
});
