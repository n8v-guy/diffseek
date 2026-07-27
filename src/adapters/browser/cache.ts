import { browser } from 'wxt/browser';

import type {
  RepositoryMetadata,
  RepositoryRef,
} from '@diffseek/repository-metadata';

export type { RepositoryMetadata, RepositoryRef };

type CacheEntry = RepositoryMetadata & {
  version: 2;
};

export async function readCache(
  repository: RepositoryRef,
): Promise<RepositoryMetadata | null> {
  const key = cacheKey(repository);
  const value = (await browser.storage.local.get(key))[key];
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    typeof value.codeowners !== 'string' ||
    typeof value.attributes !== 'string'
  ) {
    return null;
  }
  return { codeowners: value.codeowners, attributes: value.attributes };
}

export async function writeCache(
  repository: RepositoryRef,
  metadata: RepositoryMetadata,
): Promise<void> {
  const entry: CacheEntry = { version: 2, ...metadata };
  await browser.storage.local.set({ [cacheKey(repository)]: entry });
}

function cacheKey(repository: RepositoryRef): string {
  return `diffseek:metadata:${repository.owner}/${repository.repo}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
