import { describe, expect, it, vi } from 'vitest';

import { fetchMetadataSearch } from './metadata-search';

const route = (
  results: { path: string; blob_sha: string }[],
  extra: Record<string, unknown> = {},
) => ({
  payload: {
    blackbirdSearchRoute: {
      results,
      result_count: results.length,
      page_count: 1,
      page: 1,
      errors: [],
      logged_in: true,
      ...extra,
    },
  },
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });

const input = { repo: 'owner/repo' };

describe('metadata search', () => {
  it('asks github.com code search once with the browser session', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json(route([
        { path: '.github/CODEOWNERS', blob_sha: 'a' },
        { path: 'apps/.gitattributes', blob_sha: 'b' },
      ])),
    );

    await expect(fetchMetadataSearch(input, request)).resolves.toEqual([
      { path: '.github/CODEOWNERS', blob: 'a' },
      { path: 'apps/.gitattributes', blob: 'b' },
    ]);

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://github.com/search?type=code&q=${encodeURIComponent(
        'repo:owner/repo (path:**/.gitattributes OR path:**/CODEOWNERS)',
      )}`,
    );
    expect(init).toMatchObject({
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
  });

  it('follows page_count with the p parameter', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(route([{ path: 'a/.gitattributes', blob_sha: '1' }], { page_count: 2 })))
      .mockResolvedValueOnce(json(route([{ path: 'b/.gitattributes', blob_sha: '2' }], { page: 2, page_count: 2 })));

    await expect(fetchMetadataSearch(input, request)).resolves.toEqual([
      { path: 'a/.gitattributes', blob: '1' },
      { path: 'b/.gitattributes', blob: '2' },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toMatch(/&p=2$/);
  });

  it.each([
    ['an HTTP error', () => json({}, { status: 429 })],
    ['a non-JSON response', () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })],
    ['an unexpected shape', () => json({ payload: {} })],
    ['search errors', () => json(route([{ path: '.gitattributes', blob_sha: 'a' }], { errors: [{ message: 'bad' }] }))],
    ['a signed-out response', () => json(route([], { logged_in: false }))],
    ['a result without a blob', () => json(route([{ path: '.gitattributes' } as never]))],
    ['too many pages', () => json(route([{ path: '.gitattributes', blob_sha: 'a' }], { page_count: 11 }))],
  ])('is unusable on %s', async (_name, response) => {
    await expect(
      fetchMetadataSearch(input, vi.fn<typeof fetch>(async () => response())),
    ).rejects.toThrow();
  });

  it('treats a signed-in empty result as a valid answer', async () => {
    const request = vi.fn<typeof fetch>(async () => json(route([])));
    await expect(fetchMetadataSearch(input, request)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledOnce();
  });

  it('refuses a request that does not name a repository', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(fetchMetadataSearch({ repo: 'owner' }, request)).rejects.toThrow(
      'Invalid metadata search request',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
