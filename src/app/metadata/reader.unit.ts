import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { readCache, writeCache } from '@diffseek/browser';
import type { MetadataSearchResult, RawFileRequest, RawFileResult } from '@diffseek/github';

import {
  defaultMetadataTtlMs,
  pullMetadataTtlMs,
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
const refresh = (
  pull: number,
  paths: string[],
  now: number,
  request: ReturnType<typeof raw>,
  search = searching(),
  revalidate = false,
) =>
  refreshDefaultMetadata(
    { ...repository, pull, paths },
    { request, search, now: () => now, revalidate },
  );
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
    expect(none.metadata).toEqual({ codeowners: '', attributes: '', nestedAttributes: {} });
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

  it('keeps empty attributes for an empty fallback and never stores a failed read', async () => {
    const unavailable = vi.fn(async (): Promise<MetadataSearchResult> => {
      throw new Error('Metadata search is unavailable');
    });
    const empty = await refresh(1, ['a.ts'], 0, raw({}), unavailable);
    expect(empty.metadata.attributes).toBe('');

    const failing = vi.fn<Raw>(async () => {
      throw new Error('Raw file request failed with 429');
    });
    const failed = await refresh(1, ['a.ts'], 0, failing);
    expect(failed.failed).toBe(true);
    expect(failed.changed).toBe(false);
    expect(failed.cache.refreshedAt).toBe(0);
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

  it('returns empty metadata when storage is unavailable', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('unavailable'));
    expect(await readImmediateMetadata(repository)).toEqual({
      codeowners: '',
      attributes: '',
      nestedAttributes: {},
    });
  });
});

describe('refresh policy', () => {
  const paths = ['apps/web/main.ts'];

  it('keeps a listing for a week and rereads it only when asked', async () => {
    await commit(await refresh(1, paths, 1_000, raw()));

    const early = searching();
    const fresh = await refresh(1, paths, 1_000 + defaultMetadataTtlMs - 1, raw(), early, true);
    expect(early).not.toHaveBeenCalled();
    expect(fresh.due).toBe(false);

    const held = searching();
    const served = await refresh(1, paths, 1_000 + defaultMetadataTtlMs, raw(), held);
    expect(held).not.toHaveBeenCalled();
    expect(served.due).toBe(true);
    expect(served.cache.refreshedAt).toBe(1_000);

    const due = searching();
    const result = await refresh(1, paths, 1_000 + defaultMetadataTtlMs, raw(), due, true);
    expect(due).toHaveBeenCalledOnce();
    expect(result.due).toBe(false);
    expect(result.cache).toMatchObject({ refreshedAt: 1_000 + defaultMetadataTtlMs, pulls: [1] });
  });

  it('does not refresh a fresh listing for a newly opened pull request', async () => {
    await commit(await refresh(1, paths, 0, raw()));
    for (const pull of [2, 3, 4, 4, 1]) {
      const search = searching();
      await commit(await refresh(pull, paths, day, raw(), search, true));
      expect(search).not.toHaveBeenCalled();
    }
    expect((await readCache(repository))?.pulls).toEqual([1, 2, 3, 4]);
  });

  it('keeps a cached listing and its refresh time when a due search fails', async () => {
    await commit(await refresh(1, paths, 1_000, raw()));
    const failing = vi.fn(async (): Promise<MetadataSearchResult> => {
      throw new Error('Metadata search is unavailable');
    });
    const request = raw();

    const quiet = await refresh(2, paths, 1_000 + defaultMetadataTtlMs, request, failing);
    expect(failing).not.toHaveBeenCalled();
    expect(quiet.due).toBe(true);

    const result = await refresh(2, paths, 1_000 + defaultMetadataTtlMs, request, failing, true);

    expect(failing).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(result.failed).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.due).toBe(true);
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

    const result = await refresh(2, paths, 1_000 + defaultMetadataTtlMs, request, failing, true);

    expect(request).not.toHaveBeenCalled();
    expect(result.failed).toBe(true);
    expect(result.due).toBe(true);
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
    const result = await refresh(
      2,
      ['apps/web/main.ts', 'tools/a.js'],
      defaultMetadataTtlMs,
      request,
      search,
      true,
    );

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

    const result = await readPullMetadata({ ...repository, pull: 1, paths: diff }, base, {
      request,
      resolveHead,
      now: () => 0,
    });

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
      refreshedAt: 0,
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
      revalidate?: boolean;
    }) {
      const base = await commit(
        await refresh(pull, diffPaths, now, deps.request, deps.search, deps.revalidate),
      );
      return commit(
        await readPullMetadata({ ...repository, pull, paths: diffPaths }, base, {
          ...deps,
          now: () => now,
        }),
      );
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

    it('confirms the head before reading a newly streamed metadata path', async () => {
      const resolveHead = vi.fn(async () => head);
      await load(1, paths, 0, { request: raw({ ...texts, ...overlayTexts }), search: searching(), resolveHead });
      resolveHead.mockClear();
      const request = raw({ 'tools/.gitattributes': '*.js group=Changed' });

      const streamed = await load(1, [...paths, 'tools/.gitattributes'], 1, { request, search: searching(), resolveHead });

      expect(resolveHead).toHaveBeenCalledOnce();
      expect(request.mock.calls.filter(([input]) => input.ref === head).map(([input]) => input.path)).toEqual([
        'tools/.gitattributes',
      ]);
      expect(streamed.cache.overlays['1']?.files).toMatchObject({ 'tools/.gitattributes': '*.js group=Changed' });
      expect(streamed.cache.overlays['1']?.refreshedAt).toBe(0);
    });

    it('serves a pull copy for two days and rereads it only when asked', async () => {
      const resolveHead = vi.fn(async () => head);
      const files = { request: raw({ ...texts, ...overlayTexts }), search: searching(), resolveHead };
      await load(1, paths, 0, files);
      resolveHead.mockClear();

      const fresh = await load(1, paths, pullMetadataTtlMs - 1, {
        ...files,
        revalidate: true,
      });
      expect(resolveHead).not.toHaveBeenCalled();
      expect(fresh.due).toBe(false);

      const served = await load(1, paths, pullMetadataTtlMs, files);
      expect(resolveHead).not.toHaveBeenCalled();
      expect(served.due).toBe(true);
      expect(served.cache.overlays['1']?.refreshedAt).toBe(0);

      await load(1, paths, pullMetadataTtlMs, { ...files, revalidate: true });
      expect(resolveHead).toHaveBeenCalledOnce();
      expect((await readCache(repository))?.overlays['1']?.refreshedAt).toBe(pullMetadataTtlMs);
    });

    it('keeps pull file text when the reread head is unchanged', async () => {
      const resolveHead = vi.fn(async () => head);
      await load(1, paths, 0, {
        request: raw({ ...texts, ...overlayTexts }),
        search: searching(),
        resolveHead,
      });
      resolveHead.mockClear();
      const request = raw();

      const again = await load(1, paths, pullMetadataTtlMs, {
        request,
        search: searching(),
        resolveHead,
        revalidate: true,
      });

      expect(resolveHead).toHaveBeenCalledOnce();
      expect(request.mock.calls.filter(([input]) => input.ref === head)).toEqual([]);
      expect(again.cache.overlays['1']?.files).toMatchObject(overlayTexts);
      expect(again.due).toBe(false);
    });

    it('rereads only diff metadata paths when the head changes', async () => {
      const next = 'd'.repeat(40);
      const resolveHead = vi.fn().mockResolvedValueOnce(head).mockResolvedValueOnce(next);
      await load(1, paths, 0, {
        request: raw({ ...texts, ...overlayTexts }),
        search: searching(),
        resolveHead,
      });
      const request = raw({
        'apps/.gitattributes': '*.json group=Next',
        CODEOWNERS: '* @next',
        'tools/.gitattributes': '*.js group=Tools',
        '.github/CODEOWNERS': '* @github',
      });

      const again = await load(1, paths, pullMetadataTtlMs, {
        request,
        search: searching(),
        resolveHead,
        revalidate: true,
      });

      const atHead = request.mock.calls
        .map(([input]) => input)
        .filter((input) => input.ref === next);
      const byPath = (left: string, right: string): number => left.localeCompare(right);
      expect(atHead.map((input) => input.path).sort(byPath)).toEqual(
        ['CODEOWNERS', 'apps/.gitattributes'].sort(byPath),
      );
      expect(again.metadata.nestedAttributes).toMatchObject({ apps: '*.json group=Next' });
      expect(again.cache.overlays['1']?.files).not.toHaveProperty('tools/.gitattributes');
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

  it('starts the head lookup beside a cold search and does not resolve it twice', async () => {
    let resolveSearch = (_value: MetadataSearchResult): void => undefined;
    let markSearch = (): void => undefined;
    const searchStarted = new Promise<void>((resolve) => {
      markSearch = resolve;
    });
    const search = vi.fn(
      () => new Promise<MetadataSearchResult>((resolve) => {
        resolveSearch = resolve;
        markSearch();
      }),
    );
    let resolveOid = (_oid: string): void => undefined;
    const resolveHead = vi.fn(
      () => new Promise<string>((resolve) => {
        resolveOid = resolve;
      }),
    );
    const pending = refreshDefaultMetadata(
      { ...repository, pull: 1, paths: ['apps/.gitattributes', 'src/a.ts'] },
      { request: raw(), search, resolveHead, now: () => 0 },
    );
    await searchStarted;
    expect(search).toHaveBeenCalledOnce();
    expect(resolveHead).toHaveBeenCalledOnce();
    resolveSearch(indexed);
    resolveOid(head);
    const base = await pending;
    const request = raw({ 'apps/.gitattributes': '*.json group=Changed' });

    const result = await readPullMetadata(
      { ...repository, pull: 1, paths: ['apps/.gitattributes', 'src/a.ts'] },
      base,
      { request, resolveHead, now: () => 0 },
    );

    expect(resolveHead).toHaveBeenCalledOnce();
    expect(request.mock.calls.map(([input]) => input.path)).toEqual(['apps/.gitattributes']);
    expect(result.cache).not.toHaveProperty('pendingHead');
    expect(result.metadata.nestedAttributes).toMatchObject({ apps: '*.json group=Changed' });
  });

  it('does not store a head lookup that fails beside the search', async () => {
    const resolveHead = vi.fn(async () => {
      throw new Error('offline');
    });
    const base = await commit(
      await refreshDefaultMetadata(
        { ...repository, pull: 1, paths: ['CODEOWNERS'] },
        { request: raw(), search: searching(), resolveHead, now: () => 0 },
      ),
    );
    const stored = await readCache(repository);

    await expect(
      readPullMetadata({ ...repository, pull: 1, paths: ['CODEOWNERS'] }, base, {
        request: raw(),
        resolveHead,
        now: () => 0,
      }),
    ).rejects.toThrow('offline');
    expect(resolveHead).toHaveBeenCalledTimes(2);
    expect(await readCache(repository)).toEqual(stored);
    expect(stored?.overlays).toEqual({});
  });

  it('does not read the pull tip when search, the HEAD probe, and the head lookup fail', async () => {
    const request = vi.fn<Raw>(async ({ ref, path }) => {
      throw new Error(`${ref} ${path}`);
    });
    const search = vi.fn(async () => {
      throw new Error('search unavailable');
    });
    const resolveHead = vi.fn(async () => {
      throw new Error('commits 500');
    });
    const review = {
      ...repository,
      pull: 1,
      paths: ['.gitattributes', 'neutral/.gitattributes'],
    };
    const base = await refreshDefaultMetadata(review, {
      request,
      search,
      resolveHead,
      now: () => 0,
    });

    expect(base.failed).toBe(true);
    expect(base.changed).toBe(false);
    expect(base.metadata.attributes).toBe('');
    await expect(
      readPullMetadata(review, base, { request, resolveHead, now: () => 0 }),
    ).rejects.toThrow('commits 500');
    expect(search).toHaveBeenCalledOnce();
    expect(resolveHead).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => [input.ref, input.path])).toEqual([
      ['HEAD', '.gitattributes'],
    ]);
    expect(await readCache(repository)).toBeNull();
  });

  it('keeps a stored deletion when the head lookup fails', async () => {
    const oid = 'd'.repeat(40);
    await writeCache(repository, {
      files: { '.gitattributes': { blob: 'g', text: 'src/** group=Revived' } },
      refreshedAt: 1_000,
      pulls: [1],
      overlays: {
        '1': { oid, refreshedAt: 1_000, files: { '.gitattributes': null } },
      },
    });
    const review = { ...repository, pull: 1, paths: ['.gitattributes', 'CODEOWNERS'] };
    const resolveHead = vi.fn(async () => {
      throw new Error('commits 500');
    });

    expect(await readImmediateMetadata(review)).toMatchObject({ attributes: '' });
    const base = await refreshDefaultMetadata(review, {
      request: raw(),
      search: searching(),
      resolveHead,
      now: () => 1_000,
    });
    expect(base.metadata.attributes).toBe('');
    await expect(
      readPullMetadata(review, base, { request: raw(), resolveHead, now: () => 1_000 }),
    ).rejects.toThrow('commits 500');
    expect(base.metadata.attributes).toBe('');
    expect(resolveHead).toHaveBeenCalled();
  });

  it('does not look up a head when the diff has no metadata file', async () => {
    const resolveHead = vi.fn(async () => head);
    await refreshDefaultMetadata(
      { ...repository, pull: 1, paths: ['src/a.ts'] },
      { request: raw(), search: searching(), resolveHead, now: () => 0 },
    );
    expect(resolveHead).not.toHaveBeenCalled();
  });

  it('reads listing bodies from HEAD while the pull head is resolved', async () => {
    const request = raw();
    const resolveHead = vi.fn(async () => 'a'.repeat(40));
    await refreshDefaultMetadata(
      { ...repository, pull: 1, paths: ['apps/.gitattributes'] },
      { request, search: searching(), resolveHead, now: () => 0 },
    );
    expect(resolveHead).toHaveBeenCalledOnce();
    expect(request.mock.calls.length).toBeGreaterThan(0);
    expect(request.mock.calls.every(([input]) => input.ref === 'HEAD')).toBe(true);
  });

  it('keeps the stored listing time when a default-branch body read fails', async () => {
    await commit(await refresh(1, ['src/a.ts'], 1_000, raw()));
    const request = vi.fn<Raw>(async () => {
      throw new Error('raw stalled');
    });
    const search = vi.fn(async () =>
      indexed.map((file) => ({ ...file, blob: `${file.blob}-new` })),
    );
    const result = await refreshDefaultMetadata(
      { ...repository, pull: 1, paths: ['src/a.ts'] },
      { request, search, now: () => defaultMetadataTtlMs + 1_000, revalidate: true },
    );
    expect(result.failed).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.cache.refreshedAt).toBe(1_000);
    expect(result.metadata.attributes).toBe('*.ts group=Code');
    expect(await readCache(repository)).toMatchObject({ refreshedAt: 1_000 });
  });

  it('keeps pull attributes when the default CODEOWNERS read fails', async () => {
    const request = vi.fn<Raw>(async ({ ref }) => {
      if (ref === 'HEAD') throw new Error('HEAD stalled');
      return {
        status: 'found',
        text: '*.ts linguist-generated',
        contentType: 'text/plain',
        url: '',
      };
    });
    const result = await readPullMetadata(
      { ...repository, pull: 1, paths: ['.gitattributes'] },
      {
        metadata: { codeowners: '', attributes: '' },
        cache: {
          files: { CODEOWNERS: { blob: 'o2' } },
          refreshedAt: 0,
          pulls: [1],
          overlays: {},
        },
        changed: false,
      },
      { request, resolveHead: async () => head, now: () => 1 },
    );
    expect(result.metadata.attributes).toBe('*.ts linguist-generated');
    expect(result.failed).toBeUndefined();
  });

  it('looks up the head when a cached pull copy lacks a diff path', async () => {
    const base = await commit(await refresh(1, ['apps/.gitattributes'], 0, raw()));
    await writeCache(repository, {
      ...base.cache,
      overlays: {
        '1': {
          oid: head,
          refreshedAt: 0,
          files: { 'apps/.gitattributes': '*.json group=Changed' },
        },
      },
    });
    const resolveHead = vi.fn(async () => head);
    const search = searching();

    await refreshDefaultMetadata(
      { ...repository, pull: 1, paths: ['kitana/.gitattributes'] },
      { request: raw(), search, resolveHead, now: () => 1 },
    );

    expect(search).not.toHaveBeenCalled();
    expect(resolveHead).toHaveBeenCalledOnce();
  });

  it('keeps a fresh pull copy when the default listing is reread', async () => {
    const base = await refresh(1, ['apps/web/main.ts', 'apps/.gitattributes'], 0, raw());
    base.cache.refreshedAt = 0;
    base.cache.overlays['1'] = {
      oid: head,
      refreshedAt: defaultMetadataTtlMs - day,
      files: { 'apps/.gitattributes': '*.json group=Changed' },
    };
    await writeCache(repository, base.cache);
    const resolveHead = vi.fn(async () => 'e'.repeat(40));
    const search = searching();

    const listing = await refreshDefaultMetadata(
      { ...repository, pull: 1, paths: ['apps/web/main.ts', 'apps/.gitattributes'] },
      { request: raw(), search, resolveHead, now: () => defaultMetadataTtlMs, revalidate: true },
    );
    const result = await readPullMetadata(
      { ...repository, pull: 1, paths: ['apps/web/main.ts', 'apps/.gitattributes'] },
      listing,
      { request: raw(), resolveHead, now: () => defaultMetadataTtlMs, revalidate: true },
    );

    expect(search).toHaveBeenCalledOnce();
    expect(resolveHead).not.toHaveBeenCalled();
    expect(result.metadata.nestedAttributes).toMatchObject({ apps: '*.json group=Changed' });
    expect(result.cache.overlays['1']?.oid).toBe(head);
    expect(result.cache.refreshedAt).toBe(defaultMetadataTtlMs);
  });

  it('does not reread a due pull copy that fails, or fetch a path absent from the diff', async () => {
    const base = await commit(await refresh(1, diff, 0, raw()));
    base.cache.overlays['1'] = {
      oid: head,
      refreshedAt: 0,
      files: {
        'apps/.gitattributes': '*.json group=Changed',
        'tools/.gitattributes': '*.js group=Old',
      },
    };
    await writeCache(repository, base.cache);
    const stored = await readCache(repository);
    const cache = stored ?? base.cache;
    const fill = raw({ 'kitana/.gitattributes': '*.md group=Kitana' });
    const sameHead = vi.fn(async () => head);

    const served = await readPullMetadata(
      { ...repository, pull: 1, paths: ['kitana/.gitattributes', 'src/a.ts'] },
      { ...base, cache },
      { request: fill, resolveHead: sameHead, now: () => pullMetadataTtlMs },
    );
    expect(served.due).toBe(true);
    expect(sameHead).toHaveBeenCalledOnce();
    expect(fill.mock.calls.map(([input]) => [input.ref, input.path])).toEqual([
      [head, 'kitana/.gitattributes'],
    ]);
    expect(served.cache.overlays['1']?.refreshedAt).toBe(0);
    expect(served.metadata.nestedAttributes).toMatchObject({
      kitana: '*.md group=Kitana',
      tools: '*.js group=Tools',
    });

    const reread = raw();
    const resolveHead = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      readPullMetadata(
        { ...repository, pull: 1, paths: ['kitana/.gitattributes'] },
        { ...base, cache },
        { request: reread, resolveHead, now: () => pullMetadataTtlMs, revalidate: true },
      ),
    ).rejects.toThrow('offline');
    expect(reread).not.toHaveBeenCalled();
    expect(await readCache(repository)).toEqual(stored);
  });
});
