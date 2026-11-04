import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { readCache, writeCache, type RepositoryCache } from './cache';

const repository = { owner: 'owner', repo: 'repo' };
const key = 'diffseek:metadata:owner/repo';
const cache: RepositoryCache = {
  files: {
    CODEOWNERS: { blob: 'a', text: '*.ts @team' },
    'apps/.gitattributes': { blob: 'b' },
  },
  refreshedAt: 1_000,
  pulls: [4, 7],
  overlays: { '7': { oid: 'c'.repeat(40), files: { 'apps/.gitattributes': 'x', CODEOWNERS: null } } },
};

describe('metadata cache', () => {
  beforeEach(() => fakeBrowser.reset());

  it('round-trips default-branch files with their refresh bookkeeping', async () => {
    await writeCache(repository, cache);
    await expect(readCache(repository)).resolves.toEqual(cache);
    expect((await fakeBrowser.storage.local.get(key))[key]).toMatchObject({
      version: 3,
    });
  });

  it('reads a version 3 entry written before overlays existed', async () => {
    const { overlays, ...legacy } = cache;
    await fakeBrowser.storage.local.set({ [key]: { version: 3, ...legacy } });
    await expect(readCache(repository)).resolves.toEqual({ ...legacy, overlays: {} });
    expect(overlays).not.toEqual({});
  });

  it('ignores entries from an older version until they are replaced', async () => {
    await fakeBrowser.storage.local.set({
      [key]: { version: 2, codeowners: '*.ts @old', attributes: '' },
    });
    await expect(readCache(repository)).resolves.toBeNull();

    await writeCache(repository, cache);
    await expect(readCache(repository)).resolves.toEqual(cache);
  });

  it('rejects malformed files and bookkeeping from storage', async () => {
    for (const entry of [
      { ...cache, version: 3, files: { CODEOWNERS: { blob: 1 } } },
      { ...cache, version: 3, files: { CODEOWNERS: { blob: 'a', text: false } } },
      { ...cache, version: 3, refreshedAt: 'today' },
      { ...cache, version: 3, pulls: ['4'] },
      { ...cache, version: 3, overlays: { '7': { oid: 1, files: {} } } },
      { ...cache, version: 3, overlays: { '7': { oid: 'a', files: { CODEOWNERS: 5 } } } },
    ]) {
      await fakeBrowser.storage.local.set({ [key]: entry });
      await expect(readCache(repository)).resolves.toBeNull();
    }
  });

  it('drops the retired per-pull cache when it writes', async () => {
    await fakeBrowser.storage.local.set({ 'diffseek:metadata:prs': [{ pull: 1 }] });
    await writeCache(repository, cache);
    expect(await fakeBrowser.storage.local.get('diffseek:metadata:prs')).toEqual({});
  });
});
