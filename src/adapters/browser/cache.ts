import { browser } from 'wxt/browser';

import type {
  MetadataFiles,
  RepositoryRef,
} from '@diffseek/repository-metadata';

import { isRecord } from './record';

export type { RepositoryRef };

/** Default-branch metadata files and when and for which pulls they were refreshed. */
export type RepositoryCache = {
  files: MetadataFiles;
  refreshedAt: number;
  pulls: number[];
};

const cacheVersion = 3;

type CacheEntry = RepositoryCache & { version: typeof cacheVersion };

const legacyPullCacheKey = 'diffseek:metadata:prs';

export async function readCache(
  repository: RepositoryRef,
): Promise<RepositoryCache | null> {
  const key = cacheKey(repository);
  const value = (await browser.storage.local.get(key))[key];
  if (!isCacheEntry(value)) return null;
  const { files, refreshedAt, pulls } = value;
  return { files, refreshedAt, pulls };
}

export async function writeCache(
  repository: RepositoryRef,
  cache: RepositoryCache,
): Promise<void> {
  const entry: CacheEntry = { version: cacheVersion, ...cache };
  await browser.storage.local.set({ [cacheKey(repository)]: entry });
  await browser.storage.local.remove(legacyPullCacheKey);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    value.version === cacheVersion &&
    typeof value.refreshedAt === 'number' &&
    Array.isArray(value.pulls) &&
    value.pulls.every((pull) => typeof pull === 'number') &&
    isRecord(value.files) &&
    Object.values(value.files).every(
      (file) =>
        isRecord(file) &&
        typeof file.blob === 'string' &&
        (file.text === undefined || typeof file.text === 'string'),
    )
  );
}

function cacheKey(repository: RepositoryRef): string {
  return `diffseek:metadata:${repository.owner}/${repository.repo}`;
}
