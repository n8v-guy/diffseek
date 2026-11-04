import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  readCache,
  readPullCache,
  writeCache,
  writePullCache,
} from '@diffseek/browser';
import type { RawFileRequest, RawFileResult } from '@diffseek/github';
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

  it('loads nested attributes without a root file and upgrades cached PR metadata', async () => {
    const fallback = { codeowners: '', attributes: bundledGitAttributes };
    await writePullCache(review, sha, fallback);
    const directory = 'apps/contributor/shared/openapi';
    const pull = {
      ...review,
      paths: [`${directory}/metadata.json`, `${directory}/gateway.json`],
    };
    const request = vi.fn(async (input: RawFileRequest) =>
      input.path === `${directory}/.gitattributes`
        ? found('*.json linguist-generated=true')
        : missing,
    );

    const result = await readPullMetadata(pull, fallback, request, async () => sha);

    expect(result).toMatchObject({
      nestedAttributes: {
        apps: '',
        'apps/contributor': '',
        'apps/contributor/shared': '',
        [directory]: '*.json linguist-generated=true',
      },
    });
    expect(request.mock.calls.map(([input]) => input.path)).toEqual([
      'apps/.gitattributes',
      'apps/contributor/.gitattributes',
      'apps/contributor/shared/.gitattributes',
      `${directory}/.gitattributes`,
    ]);
    expect(await readImmediateMetadata(pull)).toEqual(result);

    request.mockClear();
    expect(await readPullMetadata(pull, fallback, request, async () => sha))
      .toEqual(result);
    expect(request).not.toHaveBeenCalled();
  });

  it('starts immediately with bundled source files on a cold cache', async () => {
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '',
      attributes: bundledGitAttributes,
    });
  });

  it('extends a cached head for streamed paths and drops deleted rules on a new head', async () => {
    const fallback = { codeowners: '', attributes: '' };
    const request = vi.fn(async (input: RawFileRequest) =>
      input.path === 'apps/.gitattributes' || input.path === 'web/.gitattributes'
        ? found('*.json linguist-generated=true')
        : missing,
    );
    const first = await readPullMetadata(
      { ...review, paths: ['apps/client.json'] }, fallback, request, async () => sha,
    );
    request.mockClear();
    const pull = { ...review, paths: ['apps/client.json', 'web/client.json'] };
    const extended = await readPullMetadata(pull, first, request, async () => sha);

    expect(request.mock.calls.map(([input]) => input.path)).toEqual(['web/.gitattributes']);
    expect(extended.nestedAttributes).toEqual({
      apps: '*.json linguist-generated=true',
      web: '*.json linguist-generated=true',
    });
    const updated = await readPullMetadata(pull, extended, async () => missing, async () => 'b'.repeat(40));
    expect(updated.nestedAttributes).toEqual({ apps: '', web: '' });
  });

  it('leaves failed nested reads retryable instead of caching them as missing', async () => {
    const fallback = { codeowners: '', attributes: '' };
    await writePullCache(review, sha, fallback);
    const pull = { ...review, paths: ['apps/client.json'] };
    await expect(readPullMetadata(pull, fallback, async () => {
      throw new Error('offline');
    }, async () => sha)).rejects.toThrow('Repository metadata request failed');
    expect(await readPullCache(review)).toEqual({ ...fallback, sha });

    const retry = await readPullMetadata(pull, fallback,
      async () => found('*.json linguist-generated=true'), async () => sha);
    expect(retry.nestedAttributes).toEqual({ apps: '*.json linguist-generated=true' });
  });

  it('bounds concurrent ancestor reads and waits for active requests before rejecting', async () => {
    const fallback = { codeowners: '', attributes: '' };
    await writePullCache(review, sha, fallback);
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<RawFileResult>());
    const started = Promise.withResolvers<undefined>();
    let calls = 0;
    let settled = false;
    const request = vi.fn(async () => {
      const gate = gates[calls++];
      if (calls === gates.length) started.resolve(undefined);
      return gate ? gate.promise : missing;
    });
    const pending = readPullMetadata({
      ...review, paths: ['a/x.json', 'b/x.json', 'c/x.json', 'd/x.json', 'e/x.json'],
    }, fallback, request, async () => sha);
    const rejected = pending.finally(() => { settled = true; })
      .catch((error: unknown) => error);
    await started.promise;
    expect(calls).toBe(4);
    gates[0]?.reject(new Error('offline'));
    await expect(gates[0]?.promise).rejects.toThrow('offline');
    expect(settled).toBe(false);
    for (const gate of gates.slice(1)) gate.resolve(missing);
    expect(await rejected).toEqual(new Error('Repository metadata request failed'));
    expect(calls).toBe(5);
    expect(await readPullCache(review)).toEqual({ ...fallback, sha });
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
    const request = vi.fn(async (input: RawFileRequest) => {
      if (input.path === '.gitattributes') return found('*.ts group=pull');
      if (input.path === 'CODEOWNERS') return found('*.ts @pull');
      return missing;
    });
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

  it('does not retry or store a failed gitattributes read', async () => {
    let attempts = 0;
    const request = vi.fn(async (input: RawFileRequest) => {
      if (input.path !== '.gitattributes') return missing;
      attempts += 1;
      throw new Error('Raw file request failed with 429');
    });

    await expect(
      readPullMetadata(
        review,
        { codeowners: '', attributes: bundledGitAttributes },
        request,
        async () => sha,
      ),
    ).rejects.toThrow('Repository metadata request failed');
    expect(attempts).toBe(1);
    expect(await readPullCache(review)).toBeNull();

    await expect(refreshDefaultMetadata(repository, request)).resolves.toEqual({
      metadata: {
        codeowners: '',
        attributes: bundledGitAttributes,
      },
      changed: false,
    });
    expect(await readCache(repository)).toBeNull();
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
