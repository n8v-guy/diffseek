import { browser } from 'wxt/browser';

import type {
  MetadataFiles,
  RepositoryRef,
} from '@diffseek/repository-metadata';

import { isRecord } from './record';

export type { RepositoryRef };

/**
 * Default-branch metadata files and when and for which pulls they were
 * refreshed. `overlays` holds, per pull number, the head oid and the pull's own
 * version of the metadata files in its diff (null: deleted by the pull).
 */
export type RepositoryCache = {
  files: MetadataFiles;
  refreshedAt: number;
  pulls: number[];
  overlays: Record<string, { oid: string; files: Record<string, string | null> }>;
};

const cacheVersion = 3;

type CacheEntry = Partial<RepositoryCache> &
  Omit<RepositoryCache, 'overlays'> & { version: typeof cacheVersion };

const legacyPullCacheKey = 'diffseek:metadata:prs';

export async function readCache(
  repository: RepositoryRef,
): Promise<RepositoryCache | null> {
  const key = cacheKey(repository);
  const value = (await browser.storage.local.get(key))[key];
  if (!isCacheEntry(value)) return null;
  const { files, refreshedAt, pulls, overlays = {} } = value;
  return { files, refreshedAt, pulls, overlays };
}

export async function writeCache(
  repository: RepositoryRef,
  cache: RepositoryCache,
): Promise<void> {
  const entry: CacheEntry = { version: cacheVersion, ...cache };
  await browser.storage.local.set({ [cacheKey(repository)]: entry });
  await browser.storage.local.remove(legacyPullCacheKey);
}

function isOverlay(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.oid === 'string' &&
    isRecord(value.files) &&
    Object.values(value.files).every(
      (text) => text === null || typeof text === 'string',
    )
  );
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    value.version === cacheVersion &&
    (value.overlays === undefined ||
      (isRecord(value.overlays) &&
        Object.values(value.overlays).every(isOverlay))) &&
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
