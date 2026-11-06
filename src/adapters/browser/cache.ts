import { browser } from 'wxt/browser';

import type {
  MetadataFiles,
  RepositoryRef,
} from '@diffseek/repository-metadata';

import { isRecord } from './record';

export type { RepositoryRef };

/**
 * Default-branch metadata and when it was refreshed. `overlays` holds, per
 * pull number, the head oid, when that pull's files were read, and the pull's
 * own text for metadata files in its diff (null: deleted by the pull).
 */
export type RepositoryCache = {
  files: MetadataFiles;
  refreshedAt: number;
  pulls: number[];
  overlays: Record<
    string,
    { oid: string; refreshedAt: number; files: Record<string, string | null> }
  >;
};

const cacheVersion = 4;
const migratedVersion = 3;

type StoredOverlay = {
  oid: string;
  refreshedAt?: number;
  files: Record<string, string | null>;
};

type CacheEntry = {
  version: number;
  files: RepositoryCache['files'];
  refreshedAt: number;
  pulls: number[];
  overlays?: Record<string, StoredOverlay>;
};

const legacyPullCacheKey = 'diffseek:metadata:prs';

export async function readCache(
  repository: RepositoryRef,
): Promise<RepositoryCache | null> {
  const key = cacheKey(repository);
  const value = (await browser.storage.local.get(key))[key];
  if (!isCacheEntry(value)) return null;
  return {
    files: value.files,
    refreshedAt: value.refreshedAt,
    pulls: value.pulls,
    overlays: migrateOverlays(value.overlays, value.refreshedAt),
  };
}

export async function writeCache(
  repository: RepositoryRef,
  cache: RepositoryCache,
): Promise<void> {
  const entry: CacheEntry = { version: cacheVersion, ...cache };
  await browser.storage.local.set({ [cacheKey(repository)]: entry });
  await browser.storage.local.remove(legacyPullCacheKey);
}

/** A version 3 overlay has no time of its own; it is as old as its listing. */
function migrateOverlays(
  overlays: Record<string, StoredOverlay> | undefined,
  refreshedAt: number,
): RepositoryCache['overlays'] {
  return Object.fromEntries(
    Object.entries(overlays ?? {}).map(([pull, overlay]) => [
      pull,
      {
        oid: overlay.oid,
        refreshedAt: overlay.refreshedAt ?? refreshedAt,
        files: overlay.files,
      },
    ]),
  );
}

function isOverlay(value: unknown, version: number): value is StoredOverlay {
  if (
    !isRecord(value) ||
    typeof value.oid !== 'string' ||
    !isRecord(value.files)
  ) {
    return false;
  }
  const texts = Object.values(value.files).every(
    (text) => text === null || typeof text === 'string',
  );
  if (!texts) return false;
  if (version === cacheVersion) return typeof value.refreshedAt === 'number';
  return value.refreshedAt === undefined || typeof value.refreshedAt === 'number';
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!isRecord(value)) return false;
  const version =
    value.version === cacheVersion || value.version === migratedVersion
      ? value.version
      : null;
  if (version == null) return false;
  return (
    (value.overlays === undefined ||
      (isRecord(value.overlays) &&
        Object.values(value.overlays).every((overlay) =>
          isOverlay(overlay, version),
        ))) &&
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
