import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DefaultMetadata } from '../metadata/reader';

import { loadReviewMetadata, metadataRefreshState } from './metadata-refresh';

afterEach(() => {
  vi.restoreAllMocks();
});

const base: DefaultMetadata = {
  metadata: { codeowners: '', attributes: 'src/** group=Code' },
  cache: { files: {}, refreshedAt: 0, pulls: [1] },
  changed: true,
};

describe('metadata refresh', () => {
  it('reports a failed default read, skips the PR side and does not settle', async () => {
    const failure = new Error('default offline');
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const readPull = vi.fn();
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
    expect(readPull).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
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

    readPull.mockResolvedValueOnce({ codeowners: '', attributes: 'pull' });
    loadReviewMetadata(state, options);
    await state.flight;
    expect(apply).toHaveBeenLastCalledWith({ codeowners: '', attributes: 'pull' });
    expect(state.settled).toBe(true);
  });

  it('does not commit an unchanged default and never reads again once settled', async () => {
    const commit = vi.fn();
    const refreshDefault = vi.fn(() => Promise.resolve({ ...base, changed: false }));
    const onSettled = vi.fn();
    const state = metadataRefreshState();
    const options = {
      readPull: (result: DefaultMetadata) => Promise.resolve(result.metadata),
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
});
