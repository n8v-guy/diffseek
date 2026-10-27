import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  readCache,
  readPullCache,
  writeCache,
  writePullCache,
} from '@diffseek/browser/cache';
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
const review = { ...repository, pull: 42 };
const sha = 'a'.repeat(40);

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

  it('starts known pull requests from their cache and unknown ones from HEAD', async () => {
    await writeCache(repository, {
      codeowners: '*.ts @head',
      attributes: '*.ts group=head',
    });
    await writePullCache(review, sha, {
      codeowners: '*.ts @pull',
      attributes: '*.ts group=pull',
      codeownersPath: 'CODEOWNERS',
    });

    await expect(readImmediateMetadata(review)).resolves.toEqual({
      codeowners: '*.ts @pull',
      attributes: '*.ts group=pull',
      codeownersPath: 'CODEOWNERS',
    });
    await expect(
      readImmediateMetadata({ ...repository, pull: 99 }),
    ).resolves.toEqual({
      codeowners: '*.ts @head',
      attributes: '*.ts group=head',
    });
  });

  it('caches an empty HEAD probe so warm revisits skip the walk', async () => {
    const request = vi.fn(async () => missing);
    const guard = new MetadataCommitGuard(writeCache);
    const revision = guard.begin(repository);
    const first = await refreshDefaultMetadata(repository, request);
    await guard.commit(repository, revision, first.metadata);

    expect(first.changed).toBe(true);
    expect(first.metadata).toEqual({
      codeowners: '',
      attributes: bundledGitAttributes,
    });
    request.mockClear();
    const second = await refreshDefaultMetadata(repository, request);

    expect(second.changed).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('refreshes default-branch source files once and skips later HEAD fetches', async () => {
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

    expect(first.changed).toBe(true);
    expect(codeownersRequested(request)).toEqual([
      '.github/CODEOWNERS',
      'CODEOWNERS',
    ]);
    request.mockClear();
    const second = await refreshDefaultMetadata(repository, request);

    expect(second.changed).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '*.ts @typescript',
      attributes: 'server/** group=backend',
      codeownersPath: 'CODEOWNERS',
    });
  });

  it('does not refetch HEAD CODEOWNERS or gitattributes when already cached', async () => {
    await writeCache(repository, {
      codeowners: '*.ts @cached',
      attributes: '*.ts group=cached',
    });
    const request = vi.fn(async () => found('*.ts @fresh'));

    const result = await refreshDefaultMetadata(repository, request);

    expect(result).toEqual({
      metadata: {
        codeowners: '*.ts @cached',
        attributes: '*.ts group=cached',
      },
      changed: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('replaces fallback files from the uncached PR head and stores the PR', async () => {
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
    const resolveHead = vi.fn().mockResolvedValue(sha);

    const result = await readPullMetadata(review, fallback, request, resolveHead);

    expect(result).toEqual({
      codeowners: '*.ts @pull',
      attributes: '*.ts group=pull',
      codeownersPath: 'CODEOWNERS',
    });
    expect(codeownersRequested(request)).toEqual([
      '.github/CODEOWNERS',
      'CODEOWNERS',
    ]);
    expect(resolveHead).toHaveBeenCalledWith({
      repo: 'owner/repo',
      pull: 42,
    });
    expect(await readImmediateMetadata(review)).toEqual(result);
    expect(await readImmediateMetadata(repository)).toEqual(fallback);
  });

  it('skips CODEOWNERS and gitattributes fetches when the PR head SHA is cached', async () => {
    await writePullCache(review, sha, {
      codeowners: '*.ts @pull',
      attributes: '*.ts group=pull',
      codeownersPath: 'CODEOWNERS',
    });
    const request = vi.fn(async () => found('*.ts @fresh'));

    const result = await readPullMetadata(
      review,
      {
        codeowners: '*.ts @default',
        attributes: '*.ts group=default',
      },
      request,
      async () => sha,
    );

    expect(result).toEqual({
      codeowners: '*.ts @pull',
      attributes: '*.ts group=pull',
      codeownersPath: 'CODEOWNERS',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('refetches PR files when the cached head SHA changed', async () => {
    await writePullCache(review, sha, {
      codeowners: '*.ts @stale',
      attributes: '*.ts group=stale',
    });
    const request = vi.fn(async (input: RawFileRequest) =>
      input.path === 'CODEOWNERS' ? found('*.ts @fresh') : missing,
    );

    const result = await readPullMetadata(
      review,
      {
        codeowners: '*.ts @default',
        attributes: '*.ts group=default',
      },
      request,
      async () => 'b'.repeat(40),
    );

    expect(result).toEqual({
      codeowners: '*.ts @fresh',
      attributes: '*.ts group=default',
      codeownersPath: 'CODEOWNERS',
    });
    expect(codeownersRequested(request)).toEqual([
      '.github/CODEOWNERS',
      'CODEOWNERS',
    ]);
  });

  it('keeps the previous fallback for files absent from the PR head', async () => {
    const fallback = {
      codeowners: '*.ts @default',
      attributes: '*.ts group=default',
    };

    const result = await readPullMetadata(
      review,
      fallback,
      async (input) =>
        input.path === 'CODEOWNERS' ? found('*.ts @pull') : missing,
      async () => 'b'.repeat(40),
    );

    expect(result).toEqual({
      codeowners: '*.ts @pull',
      attributes: '*.ts group=default',
      codeownersPath: 'CODEOWNERS',
    });
  });

  it('tries the default-branch CODEOWNERS path first on the PR head', async () => {
    await writeCache(repository, {
      codeowners: '*.ts @cached',
      attributes: '*.ts group=cached',
      codeownersPath: 'CODEOWNERS',
    });
    const request = vi.fn(async (input: RawFileRequest) => {
      if (input.path === 'CODEOWNERS') return found('*.ts @fresh');
      if (input.path === '.gitattributes') return found('*.ts group=fresh');
      return found('*.ts @other');
    });

    const result = await readPullMetadata(
      review,
      {
        codeowners: '*.ts @cached',
        attributes: '*.ts group=cached',
        codeownersPath: 'docs/CODEOWNERS',
      },
      request,
      async () => sha,
    );

    expect(result).toEqual({
      codeowners: '*.ts @fresh',
      attributes: '*.ts group=fresh',
      codeownersPath: 'CODEOWNERS',
    });
    expect(codeownersRequested(request)).toEqual(['CODEOWNERS']);
  });

  it('continues past a missing HEAD CODEOWNERS path in GitHub order', async () => {
    await writeCache(repository, {
      codeowners: '*.ts @cached',
      attributes: '*.ts group=cached',
      codeownersPath: 'docs/CODEOWNERS',
    });
    const request = vi.fn(async (input: RawFileRequest) => {
      if (input.path === '.github/CODEOWNERS') return found('*.ts @github');
      if (input.path === '.gitattributes') return found('*.ts group=fresh');
      return missing;
    });

    const result = await readPullMetadata(
      review,
      {
        codeowners: '*.ts @cached',
        attributes: '*.ts group=cached',
        codeownersPath: 'CODEOWNERS',
      },
      request,
      async () => sha,
    );

    expect(result).toEqual({
      codeowners: '*.ts @github',
      attributes: '*.ts group=fresh',
      codeownersPath: '.github/CODEOWNERS',
    });
    expect(codeownersRequested(request)).toEqual([
      'docs/CODEOWNERS',
      '.github/CODEOWNERS',
    ]);
  });

  it('retries a failed gitattributes read and then stores the pull', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const request = vi.fn(async (input: RawFileRequest) => {
        if (input.path !== '.gitattributes') return missing;
        attempts += 1;
        if (attempts === 1) throw new Error('Raw file request failed with 429');
        return found('src/generated.ts linguist-generated');
      });
      const pending = readPullMetadata(
        review,
        { codeowners: '', attributes: bundledGitAttributes },
        request,
        async () => sha,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated',
      });
      expect(attempts).toBe(2);
      expect(await readPullCache(review)).toMatchObject({
        sha,
        attributes: 'src/generated.ts linguist-generated',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not store a pull or default cache when every metadata read fails', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async () => {
        throw new Error('Raw file request failed with 503');
      });
      const pull = readPullMetadata(
        review,
        { codeowners: '', attributes: bundledGitAttributes },
        request,
        async () => sha,
      );
      const pullError = pull.catch((error: unknown) => error);
      const defaults = refreshDefaultMetadata(repository, request);
      await vi.advanceTimersByTimeAsync(7_000);
      await expect(pullError).resolves.toSatisfy(
        (error) =>
          error instanceof Error &&
          error.message === 'Repository metadata request failed',
      );
      await expect(defaults).resolves.toEqual({
        metadata: {
          codeowners: '',
          attributes: bundledGitAttributes,
        },
        changed: false,
      });
      expect(await readPullCache(review)).toBeNull();
      expect(await readCache(repository)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('probes CODEOWNERS in GitHub order on HEAD', async () => {
    const request = vi.fn(async (input: RawFileRequest) => {
      if (input.path === 'CODEOWNERS') return found('*.ts @root');
      if (input.path === '.gitattributes') return found('*.ts group=fresh');
      return missing;
    });

    const result = await refreshDefaultMetadata(repository, request);

    expect(result.metadata.codeownersPath).toBe('CODEOWNERS');
    expect(codeownersRequested(request)).toEqual([
      '.github/CODEOWNERS',
      'CODEOWNERS',
    ]);
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

function codeownersRequested(
  request: ReturnType<
    typeof vi.fn<(input: RawFileRequest) => Promise<RawFileResult>>
  >,
): string[] {
  return request.mock.calls
    .map(([input]) => input.path)
    .filter((path) => path.endsWith('CODEOWNERS'));
}
