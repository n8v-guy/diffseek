import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { writeCache } from '@diffseek/browser/cache';
import type {
  RawFileRequest,
  RawFileResult,
} from '@diffseek/github/repository-content/raw-file';
import {
  bundledGitAttributes,
  MetadataCommitGuard,
} from '@diffseek/repository-metadata';

import {
  readImmediateMetadata,
  readPullMetadata,
  refreshDefaultMetadata,
} from './reader';

const repository = { owner: 'owner', repo: 'repo' };

describe('repository metadata', () => {
  beforeEach(() => fakeBrowser.reset());

  it('starts immediately with bundled source files on a cold cache', async () => {
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '',
      attributes: bundledGitAttributes,
    });
  });

  it('starts with bundled source files when storage is unavailable', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(
      new Error('storage unavailable'),
    );

    await expect(readImmediateMetadata(repository)).resolves.toEqual({
      codeowners: '',
      attributes: bundledGitAttributes,
    });
  });

  it('refreshes default-branch source files and caches their replacement', async () => {
    const request = vi.fn(async (input: RawFileRequest) => {
      if (input.path === 'CODEOWNERS') return found('*.ts @typescript');
      if (input.path === '.gitattributes') {
        return found('server/** group=backend');
      }
      return missing;
    });

    const guard = new MetadataCommitGuard(writeCache);
    const revision = guard.begin(repository);
    const first = await refreshDefaultMetadata(repository, request);
    await guard.commit(repository, revision, first.metadata);
    const second = await refreshDefaultMetadata(repository, request);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '*.ts @typescript',
      attributes: 'server/** group=backend',
    });
    expect(request.mock.calls[0]?.[0]).toEqual({
      repo: 'owner/repo',
      ref: 'HEAD',
      path: '.github/CODEOWNERS',
    });
    expect(request).toHaveBeenCalledWith({
      repo: 'owner/repo',
      ref: 'HEAD',
      path: '.gitattributes',
    });
  });

  it('retains cached files independently when default refresh is unavailable', async () => {
    await writeCache(repository, {
      codeowners: '*.ts @cached',
      attributes: '*.ts group=cached',
    });

    const result = await refreshDefaultMetadata(
      repository,
      async (input) => {
        if (input.path === '.gitattributes') {
          return found('*.ts group=fresh');
        }
        throw new TypeError('offline');
      },
    );

    expect(result.metadata).toEqual({
      codeowners: '*.ts @cached',
      attributes: '*.ts group=fresh',
    });
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '*.ts @cached',
      attributes: '*.ts group=cached',
    });
  });

  it('replaces fallback files from the uncached PR head', async () => {
    await writeCache(repository, {
      codeowners: '*.ts @default',
      attributes: '*.ts group=default',
    });
    const fallback = await readImmediateMetadata(repository);
    const request = vi.fn(async (input: RawFileRequest) =>
      input.path === '.gitattributes'
        ? found('*.ts group=pull')
        : input.path === 'CODEOWNERS'
          ? found('*.ts @pull')
          : missing,
    );
    const resolveHead = vi.fn().mockResolvedValue('a'.repeat(40));

    const result = await readPullMetadata(
      { ...repository, pull: 42 },
      fallback,
      request,
      resolveHead,
    );

    expect(result).toEqual({
      codeowners: '*.ts @pull',
      attributes: '*.ts group=pull',
    });
    expect(request).toHaveBeenCalledWith({
      repo: 'owner/repo',
      ref: 'a'.repeat(40),
      path: '.gitattributes',
    });
    expect(resolveHead).toHaveBeenCalledWith({
      repo: 'owner/repo',
      pull: 42,
    });
    expect(await readImmediateMetadata(repository)).toEqual(fallback);
  });

  it('keeps the previous fallback for files absent from the PR head', async () => {
    const fallback = {
      codeowners: '*.ts @default',
      attributes: '*.ts group=default',
    };

    const result = await readPullMetadata(
      { ...repository, pull: 42 },
      fallback,
      async (input) =>
        input.path === 'CODEOWNERS' ? found('*.ts @pull') : missing,
      async () => 'b'.repeat(40),
    );

    expect(result).toEqual({
      codeowners: '*.ts @pull',
      attributes: '*.ts group=default',
    });
  });
});

const missing = { status: 'missing' } as const;

function found(text: string): Extract<RawFileResult, { status: 'found' }> {
  return {
    status: 'found',
    text,
    contentType: 'text/plain',
    url: '',
  };
}
