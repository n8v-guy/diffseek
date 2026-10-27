import { describe, expect, it, vi } from 'vitest';

import { fetchRawFile, rawFileUrl } from './raw-file';

describe('raw repository files', () => {
  it('builds a raw URL from a repository, ref, and relative path', () => {
    expect(
      rawFileUrl({
        repo: 'owner/repo',
        ref: 'feature/review',
        path: '.gitattributes',
      }),
    ).toBe(
      'https://github.com/owner/repo/raw/feature%2Freview/.gitattributes',
    );
  });

  it.each([
    { repo: 'owner', ref: 'HEAD', path: 'CODEOWNERS' },
    { repo: 'owner/repo/extra', ref: 'HEAD', path: 'CODEOWNERS' },
    { repo: 'owner/repo', ref: '', path: 'CODEOWNERS' },
    { repo: 'owner/repo', ref: '../main', path: 'CODEOWNERS' },
    { repo: 'owner/repo', ref: 'HEAD', path: '/CODEOWNERS' },
    { repo: 'owner/repo', ref: 'HEAD', path: '../CODEOWNERS' },
    { repo: 'owner/repo', ref: 'HEAD', path: 'docs\\CODEOWNERS' },
  ])('rejects an invalid request: %o', (request) => {
    expect(() => rawFileUrl(request)).toThrow('Invalid raw file request');
  });

  it('returns text and response metadata', async () => {
    const request = vi.fn(async () =>
      new Response('*.ts group=code', {
        headers: { 'content-type': 'text/plain' },
      }),
    );

    await expect(
      fetchRawFile(
        { repo: 'owner/repo', ref: 'HEAD', path: '.gitattributes' },
        request,
      ),
    ).resolves.toEqual({
      status: 'found',
      text: '*.ts group=code',
      contentType: 'text/plain',
      url: '',
    });
    expect(request).toHaveBeenCalledWith(
      'https://github.com/owner/repo/raw/HEAD/.gitattributes',
      expect.objectContaining({
        credentials: 'include',
        redirect: 'follow',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('distinguishes missing files and rejects other failures', async () => {
    await expect(
      fetchRawFile(
        { repo: 'owner/repo', ref: 'HEAD', path: 'missing' },
        async () => new Response('', { status: 404 }),
      ),
    ).resolves.toEqual({ status: 'missing' });
    await expect(
      fetchRawFile(
        { repo: 'owner/repo', ref: 'HEAD', path: 'broken' },
        async () => new Response('', { status: 500 }),
      ),
    ).rejects.toThrow('Raw file request failed with 500');
  });
});
