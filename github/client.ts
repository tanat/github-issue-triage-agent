import { Octokit } from '@octokit/rest';
import { withCache } from './cache/cache';

let octokitInstance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (octokitInstance) return octokitInstance;
  octokitInstance = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    userAgent: 'gh-triage-agent/0.1',
  });
  return octokitInstance;
}

export const octokit = new Proxy({} as Octokit, {
  get(_target, prop, receiver) {
    return Reflect.get(getOctokit(), prop, receiver);
  },
});

export async function cachedCall<T>(
  method: string,
  args: unknown,
  loader: () => Promise<T>,
): Promise<T> {
  return withCache(method, args, loader);
}
