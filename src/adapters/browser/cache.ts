import { browser } from 'wxt/browser';

import type {
  RepositoryMetadata,
  RepositoryRef,
} from '@diffseek/repository-metadata';

export type { RepositoryMetadata, RepositoryRef };

type CacheEntry = RepositoryMetadata & {
  version: 2;
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
): Promise<RepositoryMetadata | null> {
  const key = cacheKey(repository);
  const value = (await browser.storage.local.get(key))[key];
  return isCacheEntry(value) ? metadataFrom(value) : null;
}

export async function writeCache(
  repository: RepositoryRef,
  metadata: RepositoryMetadata,
): Promise<void> {
  const entry: CacheEntry = { version: 2, ...metadata };
  await browser.storage.local.set({ [cacheKey(repository)]: entry });
}

export async function readPullCache(
  review: RepositoryRef & { pull: number },
): Promise<(RepositoryMetadata & { sha: string }) | null> {
  const entry = (await readPullEntries()).find((item) =>
    samePull(item, review),
  );
  return entry == null
    ? null
    : { ...metadataFrom(entry), sha: entry.sha };
}

export async function writePullCache(
  review: RepositoryRef & { pull: number },
  sha: string,
  metadata: RepositoryMetadata,
): Promise<void> {
  const next: PullCacheEntry = {
    owner: review.owner,
    repo: review.repo,
    pull: review.pull,
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

async function readPullEntries(): Promise<PullCacheEntry[]> {
  const value = (await browser.storage.local.get(pullCacheKey))[pullCacheKey];
  return Array.isArray(value) ? value.filter(isPullCacheEntry) : [];
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    value.version === 2 &&
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

function metadataFrom(
  value: RepositoryMetadata,
): RepositoryMetadata {
  return {
    codeowners: value.codeowners,
    attributes: value.attributes,
    ...(value.codeownersPath != null
      ? { codeownersPath: value.codeownersPath }
      : {}),
  };
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

function cacheKey(repository: RepositoryRef): string {
  return `diffseek:metadata:${repository.owner}/${repository.repo}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
