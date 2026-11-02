import { describe, expect, it, vi } from 'vitest';

import { fetchRawFile, rawFileUrl } from './raw-file';

describe('raw repository files', () => {
  it('builds a raw URL from a repository, ref, and relative path', () => {
    expect(
      rawFileUrl({
        path: '.gitattributes',
        ref: 'feature/review',
        repo: 'owner/repo',
      }),
    ).toBe(
      'https://github.com/owner/repo/raw/feature%2Freview/.gitattributes',
    );
  });

  it.each([
    { path: 'CODEOWNERS', ref: 'HEAD', repo: 'owner' },
    { path: 'CODEOWNERS', ref: 'HEAD', repo: 'owner/repo/extra' },
    { path: 'CODEOWNERS', ref: '', repo: 'owner/repo' },
    { path: 'CODEOWNERS', ref: '../main', repo: 'owner/repo' },
    { path: '/CODEOWNERS', ref: 'HEAD', repo: 'owner/repo' },
    { path: '../CODEOWNERS', ref: 'HEAD', repo: 'owner/repo' },
    { path: 'docs\\CODEOWNERS', ref: 'HEAD', repo: 'owner/repo' },
  ])('rejects an invalid request: %o', (request) => {
    expect(() => rawFileUrl(request)).toThrow('Invalid raw file request');
  });

  it('returns text and response metadata', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('*.ts group=code', {
        headers: { 'content-type': 'text/plain' },
      })),
    );

    await expect(
      fetchRawFile(
        { path: '.gitattributes', ref: 'HEAD', repo: 'owner/repo' },
        request,
      ),
    ).resolves.toStrictEqual({
      contentType: 'text/plain',
      status: 'found',
      text: '*.ts group=code',
      url: '',
    });
    expect(request).toHaveBeenCalledWith(
      'https://github.com/owner/repo/raw/HEAD/.gitattributes',
      expect.objectContaining({
        credentials: 'include',
        redirect: 'follow',
      }),
    );
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('distinguishes missing files and rejects other failures', async () => {
    await expect(
      fetchRawFile(
        { path: 'missing', ref: 'HEAD', repo: 'owner/repo' },
        () => Promise.resolve(new Response('', { status: 404 })),
      ),
    ).resolves.toStrictEqual({ status: 'missing' });
    await expect(
      fetchRawFile(
        { path: 'broken', ref: 'HEAD', repo: 'owner/repo' },
        () => Promise.resolve(new Response('', { status: 500 })),
      ),
    ).rejects.toThrow('Raw file request failed with 500');
  });
});
