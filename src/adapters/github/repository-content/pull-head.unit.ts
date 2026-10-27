import { describe, expect, it, vi } from 'vitest';

import { fetchPullHead, pullCommitsUrl } from './pull-head';

describe('pull head', () => {
  it('resolves the final commit from GitHub commits-page data', async () => {
    const request = vi.fn(async () =>
      new Response(
        [
          `{"oid":"${'1'.repeat(40)}"}`,
          `{"oid":"${'2'.repeat(40)}"}`,
        ].join('\n'),
      ),
    );

    await expect(
      fetchPullHead({ repo: 'owner/repo', pull: 42 }, request),
    ).resolves.toBe('2'.repeat(40));
    expect(request).toHaveBeenCalledWith(
      'https://github.com/owner/repo/pull/42/commits',
      expect.objectContaining({
        credentials: 'include',
        redirect: 'follow',
      }),
    );
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects invalid requests and responses without a commit', async () => {
    expect(() => pullCommitsUrl({ repo: 'owner', pull: 42 })).toThrow(
      'Invalid pull head request',
    );
    await expect(
      fetchPullHead(
        { repo: 'owner/repo', pull: 42 },
        async () => new Response('no commits'),
      ),
    ).rejects.toThrow('Pull head commit is unavailable');
  });
});
