import { browser } from 'wxt/browser';

import type { RepositoryMetadata, RepositoryRef } from '@diffseek/repository-metadata';

import { isRecord, isUnknownArray } from './record';

const cacheEntryVersion = 2;

type CacheEntry = RepositoryMetadata & {
  version: typeof cacheEntryVersion;
};

type PullCacheEntry = RepositoryMetadata & {
  owner: string;
  pull: number;
  repo: string;
  sha: string;
};

const pullCacheKey = 'diffseek:metadata:prs';
const pullCacheLimit = 10;

export async function readCache(
  repository: RepositoryRef,
): Promise<null | RepositoryMetadata> {
  const key = cacheKey(repository);
  const value = (await browser.storage.local.get(key))[key];
  return isCacheEntry(value) ? metadataFrom(value) : null;
}

export async function readPullCache(
  review: RepositoryRef & { pull: number },
): Promise<null | (RepositoryMetadata & { sha: string })> {
  const entry = (await readPullEntries()).find((item) =>
    samePull(item, review),
  );
  if (entry === undefined) return null;
  return { ...metadataFrom(entry), sha: entry.sha };
}

export async function writeCache(
  repository: RepositoryRef,
  metadata: RepositoryMetadata,
): Promise<void> {
  const entry: CacheEntry = { version: cacheEntryVersion, ...metadata };
  await browser.storage.local.set({ [cacheKey(repository)]: entry });
}

export async function writePullCache(
  review: RepositoryRef & { pull: number },
  sha: string,
  metadata: RepositoryMetadata,
): Promise<void> {
  const next: PullCacheEntry = {
    owner: review.owner,
    pull: review.pull,
    repo: review.repo,
    sha,
    ...metadata,
  };
  await browser.storage.local.set({
    [pullCacheKey]: [
      next,
      ...(await readPullEntries()).filter((item) => !samePull(item, review)),
    ].slice(0, pullCacheLimit),
  });
}

function cacheKey(repository: RepositoryRef): string {
  return `diffseek:metadata:${repository.owner}/${repository.repo}`;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    value.version === cacheEntryVersion &&
    typeof value.codeowners === 'string' &&
    typeof value.attributes === 'string'
  );
}

function isPullCacheEntry(value: unknown): value is PullCacheEntry {
  return (
    isRecord(value) &&
    typeof value.owner === 'string' &&
    typeof value.repo === 'string' &&
    typeof value.pull === 'number' &&
    typeof value.sha === 'string' &&
    typeof value.codeowners === 'string' &&
    typeof value.attributes === 'string'
  );
}

function metadataFrom(value: RepositoryMetadata): RepositoryMetadata {
  const metadata: RepositoryMetadata = {
    attributes: value.attributes,
    codeowners: value.codeowners,
  };
  if (typeof value.codeownersPath === 'string') {
    metadata.codeownersPath = value.codeownersPath;
  }
  return metadata;
}

async function readPullEntries(): Promise<PullCacheEntry[]> {
  const stored = await browser.storage.local.get(pullCacheKey);
  const value = stored[pullCacheKey];
  return isUnknownArray(value) ? value.filter(isPullCacheEntry) : [];
}

function samePull(
  entry: PullCacheEntry,
  review: RepositoryRef & { pull: number },
): boolean {
  return (
    entry.owner === review.owner &&
    entry.repo === review.repo &&
    entry.pull === review.pull
  );
}

export {type RepositoryMetadata, type RepositoryRef} from '@diffseek/repository-metadata';