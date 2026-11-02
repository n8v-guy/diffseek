import type {
  RawFileRequest,
  RawFileResult,
} from '@diffseek/github/repository-content/raw-file';

import {
  readCache,
  readPullCache,
  writeCache,
  writePullCache,
} from '@diffseek/browser/cache';
import {
  bundledGitAttributes,
  MetadataCommitGuard,
} from '@diffseek/repository-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  readImmediateMetadata,
  readPullMetadata,
  refreshDefaultMetadata,
} from './reader';

const repository = { owner: 'owner', repo: 'repo' };
const review = { ...repository, pull: 42 };
const sha = 'a'.repeat(40);

describe('repository metadata', () => {
  beforeEach((): void => { fakeBrowser.reset(); });

  it('starts immediately with bundled source files on a cold cache', startsImmediatelyWithBundledSourceFilesOnAColdCache);
  it('starts with bundled source files when storage is unavailable', startsWithBundledSourceFilesWhenStorageIsUnavailable);
  it('starts known pull requests from their cache and unknown ones from HEAD', startsKnownPullRequestsFromTheirCacheAndUnknownOnesFromHEAD);
  it('caches an empty HEAD probe so warm revisits skip the walk', cachesAnEmptyHEADProbeSoWarmRevisitsSkipTheWalk);
  it('refreshes default-branch source files once and skips later HEAD fetches', refreshesDefaultBranchSourceFilesOnceAndSkipsLaterHEADFetches);
  it('does not refetch HEAD CODEOWNERS or gitattributes when already cached', doesNotRefetchHEADCODEOWNERSOrGitattributesWhenAlreadyCached);
  it('replaces fallback files from the uncached PR head and stores the PR', replacesFallbackFilesFromTheUncachedPRHeadAndStoresThePR);
  it('skips CODEOWNERS and gitattributes fetches when the PR head SHA is cached', skipsCODEOWNERSAndGitattributesFetchesWhenThePRHeadSHAIsCached);
  it('refetches PR files when the cached head SHA changed', refetchesPRFilesWhenTheCachedHeadSHAChanged);
  it('keeps the previous fallback for files absent from the PR head', keepsThePreviousFallbackForFilesAbsentFromThePRHead);
  it('tries the default-branch CODEOWNERS path first on the PR head', triesTheDefaultBranchCODEOWNERSPathFirstOnThePRHead);
  it('continues past a missing HEAD CODEOWNERS path in GitHub order', continuesPastAMissingHEADCODEOWNERSPathInGitHubOrder);
  it('does not retry or store a failed gitattributes read', doesNotRetryOrStoreAFailedGitattributesRead);
  it('probes CODEOWNERS in GitHub order on HEAD', probesCODEOWNERSInGitHubOrderOnHEAD);
});

async function cachesAnEmptyHEADProbeSoWarmRevisitsSkipTheWalk(): Promise<void> {
  const request = vi.fn<ReadFile>(() => Promise.resolve(missing));
  const first = await commitFirstDefault(request);

  expect(first.metadata).toStrictEqual({
    attributes: bundledGitAttributes,
    codeowners: '',
  });
  request.mockClear();
  const second = await refreshDefaultMetadata(repository, request);

  expect(second.changed).toBe(false);
  expect(request).not.toHaveBeenCalled();
}

async function continuesPastAMissingHEADCODEOWNERSPathInGitHubOrder(): Promise<void> {
  await writeCache(repository, {
    attributes: '*.ts group=cached',
    codeowners: '*.ts @cached',
    codeownersPath: 'docs/CODEOWNERS',
  });
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path === '.github/CODEOWNERS') return found('*.ts @github');
    if (path === '.gitattributes') return found('*.ts group=fresh');
    return missing;
  }));

  const result = await readPullMetadata(
    review,
    {
      attributes: '*.ts group=cached',
      codeowners: '*.ts @cached',
      codeownersPath: 'CODEOWNERS',
    },
    request,
    (): Promise<string> => Promise.resolve(sha),
  );

  expect(result).toStrictEqual({
    attributes: '*.ts group=fresh',
    codeowners: '*.ts @github',
    codeownersPath: '.github/CODEOWNERS',
  });
  expect(codeownersRequested(request)).toStrictEqual([
    'docs/CODEOWNERS',
    '.github/CODEOWNERS',
  ]);
}

async function doesNotRefetchHEADCODEOWNERSOrGitattributesWhenAlreadyCached(): Promise<void> {
  await writeCache(repository, {
    attributes: '*.ts group=cached',
    codeowners: '*.ts @cached',
  });
  const request = vi.fn<ReadFile>(() => Promise.resolve(found('*.ts @fresh')));

  const result = await refreshDefaultMetadata(repository, request);

  expect(result).toStrictEqual({
    changed: false,
    metadata: {
      attributes: '*.ts group=cached',
      codeowners: '*.ts @cached',
    },
  });
  expect(request).not.toHaveBeenCalled();
}

async function doesNotRetryOrStoreAFailedGitattributesRead(): Promise<void> {
  let attempts = 0;
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path !== '.gitattributes') return missing;
    attempts += 1;
    throw new Error('Raw file request failed with 429');
  }));

  await expect(
    readPullMetadata(
      review,
      { attributes: bundledGitAttributes, codeowners: '' },
      request,
      (): Promise<string> => Promise.resolve(sha),
    ),
  ).rejects.toThrow('Repository metadata request failed');
  expect(attempts).toBe(1);
  expect(await readPullCache(review)).toBeNull();

  await expect(refreshDefaultMetadata(repository, request)).resolves.toStrictEqual({
    changed: false,
    metadata: {
      attributes: bundledGitAttributes,
      codeowners: '',
    },
  });
  expect(await readCache(repository)).toBeNull();
}

async function keepsThePreviousFallbackForFilesAbsentFromThePRHead(): Promise<void> {
  const fallback = {
    attributes: '*.ts group=default',
    codeowners: '*.ts @default',
  };

  const result = await readPullMetadata(
    review,
    fallback,
    respond((path) => (path === 'CODEOWNERS' ? found('*.ts @pull') : missing)),
    (): Promise<string> => Promise.resolve('b'.repeat(40)),
  );

  expect(result).toStrictEqual({
    attributes: '*.ts group=default',
    codeowners: '*.ts @pull',
    codeownersPath: 'CODEOWNERS',
  });
}

async function probesCODEOWNERSInGitHubOrderOnHEAD(): Promise<void> {
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path === 'CODEOWNERS') return found('*.ts @root');
    if (path === '.gitattributes') return found('*.ts group=fresh');
    return missing;
  }));

  const result = await refreshDefaultMetadata(repository, request);

  expect(result.metadata.codeownersPath).toBe('CODEOWNERS');
  expect(codeownersRequested(request)).toStrictEqual([
    '.github/CODEOWNERS',
    'CODEOWNERS',
  ]);
}

async function refetchesPRFilesWhenTheCachedHeadSHAChanged(): Promise<void> {
  await writePullCache(review, sha, {
    attributes: '*.ts group=stale',
    codeowners: '*.ts @stale',
  });
  const request = vi.fn<ReadFile>(respond((path) =>
    path === 'CODEOWNERS' ? found('*.ts @fresh') : missing,
  ));

  const result = await readPullMetadata(
    review,
    {
      attributes: '*.ts group=default',
      codeowners: '*.ts @default',
    },
    request,
    (): Promise<string> => Promise.resolve('b'.repeat(40)),
  );

  expect(result).toStrictEqual({
    attributes: '*.ts group=default',
    codeowners: '*.ts @fresh',
    codeownersPath: 'CODEOWNERS',
  });
  expect(codeownersRequested(request)).toStrictEqual([
    '.github/CODEOWNERS',
    'CODEOWNERS',
  ]);
}

async function refreshesDefaultBranchSourceFilesOnceAndSkipsLaterHEADFetches(): Promise<void> {
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path === 'CODEOWNERS') return found('*.ts @typescript');
    if (path === '.gitattributes') {
      return found('server/** group=backend');
    }
    return missing;
  }));

  await commitFirstDefault(request);
  expect(codeownersRequested(request)).toStrictEqual([
    '.github/CODEOWNERS',
    'CODEOWNERS',
  ]);
  request.mockClear();
  const second = await refreshDefaultMetadata(repository, request);

  expect(second.changed).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await readImmediateMetadata(repository)).toStrictEqual({
    attributes: 'server/** group=backend',
    codeowners: '*.ts @typescript',
    codeownersPath: 'CODEOWNERS',
  });
}

async function replacesFallbackFilesFromTheUncachedPRHeadAndStoresThePR(): Promise<void> {
  await writeCache(repository, {
    attributes: '*.ts group=default',
    codeowners: '*.ts @default',
  });
  const fallback = await readImmediateMetadata(repository);
  const request = vi.fn<ReadFile>(respond(pullHeadFiles));
  const resolveHead = vi.fn<() => Promise<string>>().mockResolvedValue(sha);

  const result = await readPullMetadata(review, fallback, request, resolveHead);

  expect(result).toStrictEqual({
    attributes: '*.ts group=pull',
    codeowners: '*.ts @pull',
    codeownersPath: 'CODEOWNERS',
  });
  expect(codeownersRequested(request)).toStrictEqual([
    '.github/CODEOWNERS',
    'CODEOWNERS',
  ]);
  expect(resolveHead).toHaveBeenCalledWith({
    pull: 42,
    repo: 'owner/repo',
  });
  expect(await readImmediateMetadata(review)).toStrictEqual(result);
  expect(await readImmediateMetadata(repository)).toStrictEqual(fallback);
}

async function skipsCODEOWNERSAndGitattributesFetchesWhenThePRHeadSHAIsCached(): Promise<void> {
  await writePullCache(review, sha, {
    attributes: '*.ts group=pull',
    codeowners: '*.ts @pull',
    codeownersPath: 'CODEOWNERS',
  });
  const request = vi.fn<ReadFile>(() => Promise.resolve(found('*.ts @fresh')));

  const result = await readPullMetadata(
    review,
    {
      attributes: '*.ts group=default',
      codeowners: '*.ts @default',
    },
    request,
    (): Promise<string> => Promise.resolve(sha),
  );

  expect(result).toStrictEqual({
    attributes: '*.ts group=pull',
    codeowners: '*.ts @pull',
    codeownersPath: 'CODEOWNERS',
  });
  expect(request).not.toHaveBeenCalled();
}

async function startsImmediatelyWithBundledSourceFilesOnAColdCache(): Promise<void> {
  expect(await readImmediateMetadata(repository)).toStrictEqual({
    attributes: bundledGitAttributes,
    codeowners: '',
  });
}

async function startsKnownPullRequestsFromTheirCacheAndUnknownOnesFromHEAD(): Promise<void> {
  await writeCache(repository, {
    attributes: '*.ts group=head',
    codeowners: '*.ts @head',
  });
  await writePullCache(review, sha, {
    attributes: '*.ts group=pull',
    codeowners: '*.ts @pull',
    codeownersPath: 'CODEOWNERS',
  });

  await expect(readImmediateMetadata(review)).resolves.toStrictEqual({
    attributes: '*.ts group=pull',
    codeowners: '*.ts @pull',
    codeownersPath: 'CODEOWNERS',
  });
  await expect(
    readImmediateMetadata({ ...repository, pull: 99 }),
  ).resolves.toStrictEqual({
    attributes: '*.ts group=head',
    codeowners: '*.ts @head',
  });
}

async function startsWithBundledSourceFilesWhenStorageIsUnavailable(): Promise<void> {
  vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(
    new Error('storage unavailable'),
  );

  await expect(readImmediateMetadata(repository)).resolves.toStrictEqual({
    attributes: bundledGitAttributes,
    codeowners: '',
  });
}

async function triesTheDefaultBranchCODEOWNERSPathFirstOnThePRHead(): Promise<void> {
  await writeCache(repository, {
    attributes: '*.ts group=cached',
    codeowners: '*.ts @cached',
    codeownersPath: 'CODEOWNERS',
  });
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path === 'CODEOWNERS') return found('*.ts @fresh');
    if (path === '.gitattributes') return found('*.ts group=fresh');
    return found('*.ts @other');
  }));

  const result = await readPullMetadata(
    review,
    {
      attributes: '*.ts group=cached',
      codeowners: '*.ts @cached',
      codeownersPath: 'docs/CODEOWNERS',
    },
    request,
    (): Promise<string> => Promise.resolve(sha),
  );

  expect(result).toStrictEqual({
    attributes: '*.ts group=fresh',
    codeowners: '*.ts @fresh',
    codeownersPath: 'CODEOWNERS',
  });
  expect(codeownersRequested(request)).toStrictEqual(['CODEOWNERS']);
}

const missing = { status: 'missing' } as const;

type ReadFile = (input: RawFileRequest) => Promise<RawFileResult>;

function codeownersRequested(
  request: ReturnType<
    typeof vi.fn<(input: RawFileRequest) => Promise<RawFileResult>>
  >,
): string[] {
  return request.mock.calls
    .map(([input]) => input.path)
    .filter((path) => path.endsWith('CODEOWNERS'));
}

async function commitFirstDefault(
  request: ReadFile,
): Promise<Awaited<ReturnType<typeof refreshDefaultMetadata>>> {
  const guard = new MetadataCommitGuard(writeCache);
  const revision = guard.begin(repository);
  const first = await refreshDefaultMetadata(repository, request);
  await guard.commit(repository, revision, first.metadata);
  expect(first.changed).toBe(true);
  return first;
}

function found(text: string): Extract<RawFileResult, { status: 'found' }> {
  return {
    contentType: 'text/plain',
    status: 'found',
    text,
    url: '',
  };
}

function pullHeadFiles(path: string): RawFileResult {
  if (path === '.gitattributes') return found('*.ts group=pull');
  if (path === 'CODEOWNERS') return found('*.ts @pull');
  return missing;
}

function respond(choose: (path: string) => RawFileResult): ReadFile {
  return (input) => Promise.resolve(choose(input.path));
}
