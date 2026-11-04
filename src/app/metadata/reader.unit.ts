import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { readCache, writeCache } from '@diffseek/browser';
import type { MetadataSearchResult, RawFileRequest, RawFileResult } from '@diffseek/github';
import { bundledGitAttributes } from '@diffseek/repository-metadata';

import {
  readImmediateMetadata,
  readPullMetadata,
  refreshDefaultMetadata,
  type DefaultMetadata,
} from './reader';

const repository = { owner: 'owner', repo: 'repo' };
const day = 86_400_000;
const head = 'c'.repeat(40);
const indexed: MetadataSearchResult = [
  { path: '.github/CODEOWNERS', blob: 'o1' },
  { path: 'CODEOWNERS', blob: 'o2' },
  { path: 'docs/CODEOWNERS', blob: 'o3' },
  { path: '.gitattributes', blob: 'g0' },
  { path: 'apps/.gitattributes', blob: 'g1' },
  { path: 'apps/web/.gitattributes', blob: 'g2' },
  { path: 'tools/.gitattributes', blob: 'g3' },
];
const texts: Record<string, string> = {
  '.github/CODEOWNERS': '* @github',
  CODEOWNERS: '* @root',
  '.gitattributes': '*.ts group=Code',
  'apps/.gitattributes': '*.json linguist-generated=true',
  'apps/web/.gitattributes': '*.json linguist-generated=false',
  'tools/.gitattributes': '*.js group=Tools',
};

type Raw = (input: RawFileRequest) => Promise<RawFileResult>;
const raw = (files: Record<string, string> = texts) =>
  vi.fn<Raw>(async ({ path }) => {
    const text = files[path];
    return text === undefined
      ? { status: 'missing' }
      : { status: 'found', text, contentType: 'text/plain', url: '' };
  });
const searching = (results = indexed) =>
  vi.fn(async (_request: { repo: string }) => results);
const refresh = (pull: number, paths: string[], now: number, request: ReturnType<typeof raw>, search = searching()) =>
  refreshDefaultMetadata({ ...repository, pull, paths }, { request, search, now: () => now });
const requested = (request: ReturnType<typeof raw>) =>
  request.mock.calls.map(([input]) => input.path);

async function commit(result: DefaultMetadata): Promise<DefaultMetadata> {
  await writeCache(repository, result.cache);
  return result;
}

beforeEach(() => fakeBrowser.reset());

describe('cold read', () => {
  it('searches once, reads only the chosen CODEOWNERS and ancestor attributes, never probing', async () => {
    const request = raw();
    const search = searching();

    const result = await refresh(1, ['apps/web/main.ts', 'apps/lib/a.ts'], 1_000, request, search);

    expect(search).toHaveBeenCalledExactlyOnceWith({ repo: 'owner/repo' });
    expect(requested(request)).toHaveLength(4);
    expect(requested(request)).toEqual(expect.arrayContaining([
      '.github/CODEOWNERS',
      '.gitattributes',
      'apps/.gitattributes',
      'apps/web/.gitattributes',
    ]));
    expect(request.mock.calls.every(([input]) => input.ref === 'HEAD')).toBe(true);
    expect(result.metadata).toEqual({
      codeowners: '* @github',
      attributes: '*.ts group=Code',
      nestedAttributes: {
        apps: '*.json linguist-generated=true',
        'apps/web': '*.json linguist-generated=false',
      },
    });
    expect(result.cache).toMatchObject({ refreshedAt: 1_000, pulls: [1] });
    expect(result.cache.files['tools/.gitattributes']).toEqual({ blob: 'g3' });
    expect(result.changed).toBe(true);
  });

  it('caches an empty search as none, then makes no request until the next refresh', async () => {
    const request = raw();
    const none = await commit(await refresh(1, ['a.ts'], 0, request, searching([])));

    expect(request).not.toHaveBeenCalled();
    expect(none.metadata).toEqual({ codeowners: '', attributes: bundledGitAttributes, nestedAttributes: {} });
    expect(none.cache.files).toEqual({});

    const search = searching();
    const warm = await refresh(1, ['a.ts', 'b/c.ts'], day - 1, request, search);
    expect(search).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(warm.metadata).toEqual(none.metadata);
  });

  it('picks CODEOWNERS from the search results by precedence', async () => {
    const request = raw();
    const results = indexed.filter(({ path }) => path.endsWith('CODEOWNERS') && path !== '.github/CODEOWNERS');

    await refresh(1, ['a.ts'], 0, request, searching(results));
    expect(requested(request)).toEqual(['CODEOWNERS']);
  });

  it('falls back to bounded spot-checks when search is unusable', async () => {
    const request = raw({ 'docs/CODEOWNERS': '* @docs', '.gitattributes': '*.ts group=Code' });
    const search = vi.fn(async () => {
      throw new Error('Metadata search is unavailable');
    });

    const result = await refresh(1, ['apps/web/main.ts', 'tools/x.js'], 0, request, search);

    expect(requested(request)).toEqual([
      '.gitattributes',
      '.github/CODEOWNERS',
      'CODEOWNERS',
      'docs/CODEOWNERS',
    ]);
    expect(result.metadata).toEqual({
      codeowners: '* @docs',
      attributes: '*.ts group=Code',
      nestedAttributes: {},
    });
  });

  it('stops spot-checking at the first CODEOWNERS and makes at most four requests', async () => {
    const request = raw({ CODEOWNERS: '* @root' });
    const search = vi.fn(async (): Promise<MetadataSearchResult> => {
      throw new Error('signed out');
    });
    await refresh(1, ['a/b/c/d.ts'], 0, request, search);
    expect(requested(request)).toEqual(['.gitattributes', '.github/CODEOWNERS', 'CODEOWNERS']);

    const none = raw({});
    await refresh(2, ['a/b/c/d.ts'], 0, none, search);
    expect(none).toHaveBeenCalledTimes(4);
  });

  it('serves bundled assumptions for an empty fallback and never stores a failed read', async () => {
    const unavailable = vi.fn(async (): Promise<MetadataSearchResult> => {
      throw new Error('Metadata search is unavailable');
    });
    const empty = await refresh(1, ['a.ts'], 0, raw({}), unavailable);
    expect(empty.metadata.attributes).toBe(bundledGitAttributes);

    const failing = vi.fn<Raw>(async () => {
      throw new Error('Raw file request failed with 429');
    });
    await expect(refresh(1, ['a.ts'], 0, failing)).rejects.toThrow('429');
    expect(await readCache(repository)).toBeNull();
  });
});

describe('warm and hot reads', () => {
  it('make no metadata request at all, however the diff streams in', async () => {
    const paths = ['apps/web/main.ts'];
    await commit(await refresh(1, paths, 0, raw()));

    const request = raw();
    const search = searching();
    expect(await readImmediateMetadata(repository)).toMatchObject({ codeowners: '* @github' });
    for (const [pull, streamed] of [[1, paths], [1, [...paths, 'apps/web/more.ts', 'x/y.ts']], [2, paths]] as const) {
      const result = await refresh(pull, [...streamed], day - 1, request, search);
      expect(result.metadata.nestedAttributes).toMatchObject({ 'apps/web': '*.json linguist-generated=false' });
      await commit(result);
    }
    expect(search).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('read only a newly relevant ancestor known from the cached search', async () => {
    await commit(await refresh(1, ['apps/web/main.ts'], 0, raw()));

    const request = raw();
    const search = searching();
    const result = await refresh(1, ['apps/web/main.ts', 'tools/run.js'], 1, request, search);

    expect(requested(request)).toEqual(['tools/.gitattributes']);
    expect(search).not.toHaveBeenCalled();
    expect(result.metadata.nestedAttributes).toMatchObject({ tools: '*.js group=Tools' });
    expect(result.cache.refreshedAt).toBe(0);
    expect(result.changed).toBe(true);

    await commit(result);
    request.mockClear();
    expect((await refresh(1, ['tools/run.js', 'apps/x.ts'], 2, request, search)).changed).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('ignore a cache from the previous version and search once', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:metadata:owner/repo': { version: 2, codeowners: '* @old', attributes: '' },
    });
    expect(await readImmediateMetadata(repository)).toMatchObject({ codeowners: '' });
    const search = searching();

    await refresh(1, ['a.ts'], 0, raw(), search);
    expect(search).toHaveBeenCalledOnce();
  });

  it('start from bundled assumptions when storage is unavailable', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('unavailable'));
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '',
      attributes: bundledGitAttributes,
      nestedAttributes: {},
    });
  });
});

describe('refresh policy', () => {
  const paths = ['apps/web/main.ts'];

  it('refreshes once a day', async () => {
    await commit(await refresh(1, paths, 1_000, raw()));

    const early = searching();
    await refresh(1, paths, 1_000 + day - 1, raw(), early);
    expect(early).not.toHaveBeenCalled();

    const due = searching();
    const result = await refresh(1, paths, 1_000 + day, raw(), due);
    expect(due).toHaveBeenCalledOnce();
    expect(result.cache).toMatchObject({ refreshedAt: 1_000 + day, pulls: [1] });
  });

  it('refreshes on every 3rd distinct pull request, not on revisits', async () => {
    await commit(await refresh(1, paths, 0, raw()));
    for (const pull of [2, 3, 3, 1, 2]) {
      const search = searching();
      await commit(await refresh(pull, paths, 1, raw(), search));
      expect(search).not.toHaveBeenCalled();
    }
    expect((await readCache(repository))?.pulls).toEqual([1, 2, 3]);

    const search = searching();
    const result = await commit(await refresh(4, paths, 2, raw(), search));
    expect(search).toHaveBeenCalledOnce();
    expect(result.cache.pulls).toEqual([4]);

    const next = searching();
    await commit(await refresh(5, paths, 3, raw(), next));
    await commit(await refresh(6, paths, 4, raw(), next));
    expect(next).not.toHaveBeenCalled();
    await refresh(7, paths, 5, raw(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps a cached listing and its refresh time when a due search fails', async () => {
    await commit(await refresh(1, paths, 1_000, raw()));
    const failing = vi.fn(async (): Promise<MetadataSearchResult> => {
      throw new Error('Metadata search is unavailable');
    });
    const request = raw();

    const result = await refresh(2, paths, 1_000 + day, request, failing);

    expect(failing).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(result.cache.refreshedAt).toBe(1_000);
    expect(Object.keys(result.cache.files)).toHaveLength(indexed.length);
    expect(result.metadata.nestedAttributes).toMatchObject({ 'apps/web': '*.json linguist-generated=false' });
  });

  it('keeps a cached none, without probing, when a due search fails', async () => {
    await commit(await refresh(1, paths, 1_000, raw(), searching([])));
    const failing = vi.fn(async (): Promise<MetadataSearchResult> => {
      throw new Error('Metadata search is unavailable');
    });
    const request = raw();

    const result = await refresh(2, paths, 1_000 + day, request, failing);

    expect(request).not.toHaveBeenCalled();
    expect(result.cache).toMatchObject({ refreshedAt: 1_000, files: {} });
  });

  it('rereads only blobs that changed and drops files that disappeared', async () => {
    await commit(await refresh(1, ['apps/web/main.ts', 'tools/a.js'], 0, raw()));

    const request = raw({ ...texts, 'apps/.gitattributes': '*.json group=New' });
    const search = searching(
      indexed
        .filter(({ path }) => path !== 'apps/web/.gitattributes')
        .map((file) => (file.path === 'apps/.gitattributes' ? { ...file, blob: 'g1b' } : file)),
    );
    const result = await refresh(2, ['apps/web/main.ts', 'tools/a.js'], day, request, search);

    expect(requested(request)).toEqual(['apps/.gitattributes']);
    expect(result.metadata.nestedAttributes).toEqual({ apps: '*.json group=New', tools: '*.js group=Tools' });
    expect(result.cache.files).not.toHaveProperty(['apps/web/.gitattributes']);
    expect(result.cache.files['apps/.gitattributes']).toEqual({ blob: 'g1b', text: '*.json group=New' });
  });
});

describe('pull request side', () => {
  const diff = ['apps/web/main.ts', 'apps/.gitattributes', 'CODEOWNERS', 'tools/.gitattributes'];

  it('makes no request when the diff holds no metadata file', async () => {
    const base = await refresh(1, ['apps/web/main.ts'], 0, raw());
    const request = raw();
    const resolveHead = vi.fn(async () => head);

    const result = await readPullMetadata({ ...repository, pull: 1, paths: ['apps/web/main.ts'] }, base, { request, resolveHead });

    expect(result.metadata).toBe(base.metadata);
    expect(result.changed).toBe(false);
    expect(resolveHead).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('reads only the diff-included metadata files at the head and overrides the default', async () => {
    const base = await refresh(1, diff, 0, raw());
    expect(base.metadata.nestedAttributes).toMatchObject({ apps: '*.json linguist-generated=true' });
    const request = raw({
      'apps/.gitattributes': '*.json group=Changed',
      CODEOWNERS: '* @changed',
    });
    const resolveHead = vi.fn(async () => head);

    const result = await readPullMetadata({ ...repository, pull: 1, paths: diff }, base, { request, resolveHead });

    expect(resolveHead).toHaveBeenCalledExactlyOnceWith({ repo: 'owner/repo', pull: 1 });
    expect(request.mock.calls.map(([input]) => [input.ref, input.path])).toEqual([
      [head, 'apps/.gitattributes'],
      [head, 'CODEOWNERS'],
      [head, 'tools/.gitattributes'],
    ]);
    expect(result.metadata.nestedAttributes).toEqual({
      apps: '*.json group=Changed',
      'apps/web': '*.json linguist-generated=false',
    });
    expect(result.metadata.codeowners).toBe('* @github');
    expect(result.cache.overlays['1']).toEqual({
      oid: head,
      files: { 'apps/.gitattributes': '*.json group=Changed', CODEOWNERS: '* @changed', 'tools/.gitattributes': null },
    });
    expect(base.metadata.nestedAttributes).toMatchObject({ apps: '*.json linguist-generated=true' });
  });

  it('applies a CODEOWNERS added or a rule deleted by the pull request', async () => {
    const base = await refresh(1, ['apps/web/main.ts'], 0, raw(), searching(indexed.slice(1)));
    expect(base.metadata.codeowners).toBe('* @root');
    const added = await readPullMetadata(
      { ...repository, pull: 1, paths: ['.github/CODEOWNERS'] },
      base,
      { request: raw({ '.github/CODEOWNERS': '* @new' }), resolveHead: async () => head },
    );
    expect(added.metadata.codeowners).toBe('* @new');

    const deleted = await readPullMetadata(
      { ...repository, pull: 1, paths: ['apps/web/.gitattributes'] },
      base,
      { request: raw({}), resolveHead: async () => head },
    );
    expect(deleted.metadata.nestedAttributes).toEqual({ apps: '*.json linguist-generated=true' });
  });

  it('reads the next known CODEOWNERS from HEAD when the pull deletes the chosen one', async () => {
    const base = await refresh(1, ['a.ts'], 0, raw());
    expect(base.metadata.codeowners).toBe('* @github');
    const request = raw({ CODEOWNERS: '* @root' });

    const result = await readPullMetadata(
      { ...repository, pull: 1, paths: ['.github/CODEOWNERS'] },
      base,
      { request, resolveHead: async () => head },
    );

    expect(request.mock.calls.map(([input]) => [input.ref, input.path])).toEqual([
      [head, '.github/CODEOWNERS'],
      ['HEAD', 'CODEOWNERS'],
    ]);
    expect(result.metadata.codeowners).toBe('* @root');
    expect(result.cache.files.CODEOWNERS).toEqual({ blob: 'o2', text: '* @root' });
  });

  describe('on warm and hot loads', () => {
    const paths = ['apps/web/main.ts', 'apps/.gitattributes', 'CODEOWNERS'];
    const overlayTexts = { 'apps/.gitattributes': '*.json group=Changed', CODEOWNERS: '* @changed' };

    async function load(pull: number, diffPaths: string[], now: number, deps: {
      request: ReturnType<typeof raw>;
      search: ReturnType<typeof searching>;
      resolveHead: () => Promise<string>;
    }) {
      const base = await commit(await refresh(pull, diffPaths, now, deps.request, deps.search));
      return commit(await readPullMetadata({ ...repository, pull, paths: diffPaths }, base, deps));
    }

    it('make no request of any kind once the overlay is stored', async () => {
      const resolveHead = vi.fn(async () => head);
      const cold = await load(1, paths, 0, { request: raw({ ...texts, ...overlayTexts }), search: searching(), resolveHead });
      expect(resolveHead).toHaveBeenCalledOnce();
      expect(cold.metadata.nestedAttributes).toMatchObject({ apps: '*.json group=Changed' });

      resolveHead.mockClear();
      const request = raw();
      const search = searching();
      for (const now of [1, 2]) {
        const warm = await load(1, paths, now, { request, search, resolveHead });
        expect(warm.metadata).toEqual(cold.metadata);
        expect(warm.changed).toBe(false);
      }
      expect(resolveHead).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
    });

    it('read only a newly streamed metadata path at the stored head', async () => {
      const resolveHead = vi.fn(async () => head);
      await load(1, paths, 0, { request: raw({ ...texts, ...overlayTexts }), search: searching(), resolveHead });
      resolveHead.mockClear();
      const request = raw({ 'tools/.gitattributes': '*.js group=Changed' });

      const streamed = await load(1, [...paths, 'tools/.gitattributes'], 1, { request, search: searching(), resolveHead });

      expect(resolveHead).not.toHaveBeenCalled();
      expect(request.mock.calls.filter(([input]) => input.ref === head).map(([input]) => input.path)).toEqual([
        'tools/.gitattributes',
      ]);
      expect(streamed.cache.overlays['1']?.files).toMatchObject({ 'tools/.gitattributes': '*.js group=Changed' });
    });

    it('resolve the head again only when the default branch refreshes', async () => {
      const resolveHead = vi.fn(async () => head);
      await load(1, paths, 0, { request: raw({ ...texts, ...overlayTexts }), search: searching(), resolveHead });
      resolveHead.mockClear();

      await load(1, paths, day, { request: raw({ ...texts, ...overlayTexts }), search: searching(), resolveHead });
      expect(resolveHead).toHaveBeenCalledOnce();
    });
  });

  it('fails the read and stores nothing when the head cannot be read', async () => {
    const base = await commit(await refresh(1, diff, 0, raw()));
    const stored = await readCache(repository);

    await expect(
      readPullMetadata({ ...repository, pull: 1, paths: diff }, base, {
        request: raw(),
        resolveHead: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow('offline');
    expect(await readCache(repository)).toEqual(stored);
  });
});
