import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadReviewMetadata, metadataRefreshState } from './metadata-refresh';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metadata refresh', () => {
  it('reports a failed read and does not settle', async () => {
    const pullError = new Error('pull offline');
    const defaultError = new Error('default offline');
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const apply = vi.fn();
    const state = metadataRefreshState();
    loadReviewMetadata(state, {
      readPull: () => Promise.reject(pullError),
      refreshDefault: () => Promise.reject(defaultError),
      commit: () => Promise.resolve(true),
      aborted: () => false,
      apply,
    });
    await state.flight;
    expect(reported).toHaveBeenCalledWith(pullError);
    expect(reported).toHaveBeenCalledWith(defaultError);
    expect(apply).not.toHaveBeenCalled();
    expect(state.settled).toBe(false);
  });
});
