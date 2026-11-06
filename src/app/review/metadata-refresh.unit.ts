import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DefaultMetadata } from '../metadata/reader';

import {
  loadReviewMetadata,
  loadSessionMetadata,
  metadataRefreshState,
  streamedMetadataStale,
  trackedMetadata,
} from './metadata-refresh';
import { quietRevalidate } from './quiet-revalidate';

afterEach(() => {
  vi.restoreAllMocks();
});

const base: DefaultMetadata = {
  metadata: { codeowners: '', attributes: 'src/** group=Code' },
  cache: { files: {}, refreshedAt: 0, pulls: [1], overlays: {} },
  changed: true,
};

describe('metadata refresh', () => {
  it('still reads the pull request when the default read fails', async () => {
    const failure = new Error('default offline');
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pulled = {
      ...base,
      metadata: { codeowners: '', attributes: '*.ts linguist-generated' },
    };
    const readPull = vi.fn(() => Promise.resolve(pulled));
    const apply = vi.fn();
    const state = metadataRefreshState();
    loadReviewMetadata(state, {
      readPull,
      refreshDefault: () => Promise.reject(failure),
      commit: () => Promise.resolve(true),
      aborted: () => false,
      apply,
    });
    await state.flight;
    expect(reported).toHaveBeenCalledWith(failure);
    expect(readPull).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledExactlyOnceWith(pulled.metadata);
    expect(state.settled).toBe(true);
  });

  it('does not chain another lookup after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let rejectDefault = (_error: Error): void => undefined;
    const refreshDefault = vi.fn(
      () => new Promise<DefaultMetadata>((_resolve, reject) => {
        rejectDefault = reject;
      }),
    );
    const state = metadataRefreshState();
    loadReviewMetadata(state, {
      refreshDefault,
      readPull: vi.fn(),
      commit: () => Promise.resolve(true),
      aborted: () => false,
      apply: vi.fn(),
    });
    state.pending = true;
    rejectDefault(new Error('offline'));
    await state.flight;
    expect(refreshDefault).toHaveBeenCalledOnce();
    expect(state.pending).toBe(false);
    expect(state.settled).toBe(false);
  });

  it('keeps the committed default when the PR side fails and retries it', async () => {
    const failure = new Error('pull offline');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const commit = vi.fn().mockResolvedValue(true);
    const apply = vi.fn();
    const readPull = vi.fn().mockRejectedValueOnce(failure);
    const state = metadataRefreshState();
    const options = {
      readPull,
      refreshDefault: () => Promise.resolve(base),
      commit,
      aborted: () => false,
      apply,
    };
    loadReviewMetadata(state, options);
    await state.flight;
    expect(apply).toHaveBeenCalledExactlyOnceWith(base.metadata);
    expect(commit).toHaveBeenCalledExactlyOnceWith(base.cache);
    expect(state.settled).toBe(false);

    const pulled = { ...base, metadata: { codeowners: '', attributes: 'pull' } };
    readPull.mockResolvedValueOnce(pulled);
    loadReviewMetadata(state, options);
    await state.flight;
    expect(apply).toHaveBeenLastCalledWith(pulled.metadata);
    expect(commit).toHaveBeenLastCalledWith(pulled.cache);
    expect(state.settled).toBe(true);
  });

  it('does not commit an unchanged default and never reads again once settled', async () => {
    const commit = vi.fn();
    const refreshDefault = vi.fn(() => Promise.resolve({ ...base, changed: false }));
    const onSettled = vi.fn();
    const state = metadataRefreshState();
    const options = {
      readPull: (result: DefaultMetadata) => Promise.resolve({ ...result, changed: false }),
      refreshDefault,
      commit,
      aborted: () => false,
      apply: vi.fn(),
      onSettled,
    };
    loadReviewMetadata(state, options);
    await state.flight;
    loadReviewMetadata(state, options);

    expect(commit).not.toHaveBeenCalled();
    expect(refreshDefault).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('reports an unfinished read and a settled one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFinished = vi.fn();
    const state = metadataRefreshState();
    loadReviewMetadata(state, {
      readPull: () => Promise.reject(new Error('offline')),
      refreshDefault: () => Promise.resolve(base),
      commit: () => Promise.resolve(true),
      aborted: () => false,
      apply: vi.fn(),
      onFinished,
    });
    await state.flight;
    expect(onFinished).toHaveBeenCalledExactlyOnceWith(false);

    loadReviewMetadata(state, {
      readPull: (result: DefaultMetadata) => Promise.resolve(result),
      refreshDefault: () => Promise.resolve(base),
      commit: () => Promise.resolve(true),
      aborted: () => false,
      apply: vi.fn(),
      onFinished,
    });
    await state.flight;
    expect(onFinished).toHaveBeenLastCalledWith(true);
  });
});

describe('failed metadata lookup', () => {
  it('tries once more, then waits for quiet instead of reading on the next call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = metadataRefreshState();
    const tracked = trackedMetadata();
    const quiet = quietRevalidate({ arm() {}, cancel() {} }, () => undefined);
    const readPull = vi.fn(() => Promise.reject(new Error('offline')));
    const load = (): void => {
      loadSessionMetadata({
        state,
        tracked,
        quiet,
        paths: () => ['.gitattributes'],
        readDefault: () => Promise.resolve({ ...base, changed: false }),
        readPull,
        commit: () => Promise.resolve(true),
        aborted: () => false,
        autoView: false,
        current: () => base.metadata,
        needsPass: () => true,
        schedule: () => undefined,
        store: () => undefined,
        reopen: () => false,
      });
    };
    load();
    state.pending = true;
    await state.flight;
    await state.flight;
    expect(readPull).toHaveBeenCalledTimes(2);
    expect(tracked.held).toBe(true);
    expect(state.pending).toBe(false);
    load();
    expect(readPull).toHaveBeenCalledTimes(2);
  });
});

describe('streamed metadata paths', () => {
  it('reopens when a metadata path replaces another at the same tree size', () => {
    const state = trackedMetadata();
    state.seenPaths = ['a.ts', 'b.ts'].sort((left, right) => left.localeCompare(right)).join('\n');
    expect(streamedMetadataStale(false, state, ['a.ts', '.gitattributes'])).toBeNull();
    expect(
      streamedMetadataStale(true, state, ['a.ts', '.gitattributes']),
    ).toEqual({ stale: true });
    expect(state.seenPaths).toBe(
      ['a.ts', 'b.ts'].sort((left, right) => left.localeCompare(right)).join('\n'),
    );
  });

  it('remembers a tree that needs nothing and ignores the same tree', () => {
    const state = trackedMetadata();
    expect(streamedMetadataStale(true, state, ['a.ts', 'b.ts'])).toEqual({ stale: false });
    expect(streamedMetadataStale(true, state, ['b.ts', 'a.ts'])).toBeNull();
  });
});
