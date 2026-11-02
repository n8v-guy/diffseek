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
  type RepositoryMetadata,
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
const bundled = { attributes: bundledGitAttributes, codeowners: '' };
const cached = { attributes: '*.ts group=cached', codeowners: '*.ts @cached' };
const defaults = { attributes: '*.ts group=default', codeowners: '*.ts @default' };
const pulled = {
  attributes: '*.ts group=pull',
  codeowners: '*.ts @pull',
  codeownersPath: 'CODEOWNERS',
};
const headProbe = ['.github/CODEOWNERS', 'CODEOWNERS'];

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

  expect(first.metadata).toStrictEqual(bundled);
  request.mockClear();
  const second = await refreshDefaultMetadata(repository, request);

  expect(second.changed).toBe(false);
  expect(request).not.toHaveBeenCalled();
}

async function continuesPastAMissingHEADCODEOWNERSPathInGitHubOrder(): Promise<void> {
  await writeCache(repository, { ...cached, codeownersPath: 'docs/CODEOWNERS' });
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path === '.github/CODEOWNERS') return found('*.ts @github');
    if (path === '.gitattributes') return found('*.ts group=fresh');
    return missing;
  }));

  const result = await readPull({ ...cached, codeownersPath: 'CODEOWNERS' }, request);

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
  await writeCache(repository, cached);
  const request = vi.fn<ReadFile>(() => Promise.resolve(found('*.ts @fresh')));

  const result = await refreshDefaultMetadata(repository, request);

  expect(result).toStrictEqual({ changed: false, metadata: cached });
  expect(request).not.toHaveBeenCalled();
}

async function doesNotRetryOrStoreAFailedGitattributesRead(): Promise<void> {
  let attempts = 0;
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path !== '.gitattributes') return missing;
    attempts += 1;
    throw new Error('Raw file request failed with 429');
  }));

  await expect(readPull(bundled, request)).rejects.toThrow(
    'Repository metadata request failed',
  );
  expect(attempts).toBe(1);
  expect(await readPullCache(review)).toBeNull();

  await expect(refreshDefaultMetadata(repository, request)).resolves.toStrictEqual({
    changed: false,
    metadata: bundled,
  });
  expect(await readCache(repository)).toBeNull();
}

async function keepsThePreviousFallbackForFilesAbsentFromThePRHead(): Promise<void> {
  const result = await readPull(
    defaults,
    respond((path) => (path === 'CODEOWNERS' ? found('*.ts @pull') : missing)),
    'b'.repeat(40),
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
  expect(codeownersRequested(request)).toStrictEqual(headProbe);
}

async function refetchesPRFilesWhenTheCachedHeadSHAChanged(): Promise<void> {
  await writePullCache(review, sha, {
    attributes: '*.ts group=stale',
    codeowners: '*.ts @stale',
  });
  const request = vi.fn<ReadFile>(respond((path) =>
    path === 'CODEOWNERS' ? found('*.ts @fresh') : missing,
  ));

  const result = await readPull(defaults, request, 'b'.repeat(40));

  expect(result).toStrictEqual({
    attributes: '*.ts group=default',
    codeowners: '*.ts @fresh',
    codeownersPath: 'CODEOWNERS',
  });
  expect(codeownersRequested(request)).toStrictEqual(headProbe);
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
  expect(codeownersRequested(request)).toStrictEqual(headProbe);
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
  await writeCache(repository, defaults);
  const fallback = await readImmediateMetadata(repository);
  const request = vi.fn<ReadFile>(respond(pullHeadFiles));
  const resolveHead = vi.fn<() => Promise<string>>().mockResolvedValue(sha);

  const result = await readPullMetadata(review, fallback, { request, resolveHead });

  expect(result).toStrictEqual(pulled);
  expect(codeownersRequested(request)).toStrictEqual(headProbe);
  expect(resolveHead).toHaveBeenCalledWith({
    pull: 42,
    repo: 'owner/repo',
  });
  expect(await readImmediateMetadata(review)).toStrictEqual(result);
  expect(await readImmediateMetadata(repository)).toStrictEqual(fallback);
}

async function skipsCODEOWNERSAndGitattributesFetchesWhenThePRHeadSHAIsCached(): Promise<void> {
  await writePullCache(review, sha, pulled);
  const request = vi.fn<ReadFile>(() => Promise.resolve(found('*.ts @fresh')));

  const result = await readPull(defaults, request);

  expect(result).toStrictEqual(pulled);
  expect(request).not.toHaveBeenCalled();
}

async function startsImmediatelyWithBundledSourceFilesOnAColdCache(): Promise<void> {
  expect(await readImmediateMetadata(repository)).toStrictEqual(bundled);
}

async function startsKnownPullRequestsFromTheirCacheAndUnknownOnesFromHEAD(): Promise<void> {
  await writeCache(repository, {
    attributes: '*.ts group=head',
    codeowners: '*.ts @head',
  });
  await writePullCache(review, sha, pulled);

  await expect(readImmediateMetadata(review)).resolves.toStrictEqual(pulled);
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

  await expect(readImmediateMetadata(repository)).resolves.toStrictEqual(bundled);
}

async function triesTheDefaultBranchCODEOWNERSPathFirstOnThePRHead(): Promise<void> {
  await writeCache(repository, { ...cached, codeownersPath: 'CODEOWNERS' });
  const request = vi.fn<ReadFile>(respond((path) => {
    if (path === 'CODEOWNERS') return found('*.ts @fresh');
    if (path === '.gitattributes') return found('*.ts group=fresh');
    return found('*.ts @other');
  }));

  const result = await readPull({ ...cached, codeownersPath: 'docs/CODEOWNERS' }, request);

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

function readPull(
  fallback: RepositoryMetadata,
  request: ReadFile,
  head = sha,
): Promise<RepositoryMetadata> {
  return readPullMetadata(review, fallback, {
    request,
    resolveHead: (): Promise<string> => Promise.resolve(head),
  });
}

function respond(choose: (path: string) => RawFileResult): ReadFile {
  return (input) => Promise.resolve(choose(input.path));
}
