import { describe, expect, it, vi } from 'vitest';

import { MetadataCommitGuard } from './commit-guard';

const repository = { owner: 'owner', repo: 'repo' };

describe('MetadataCommitGuard', () => {
  it('drops an older refresh queued after a newer review session starts', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const guard = new MetadataCommitGuard(write);
    const stale = guard.begin(repository);
    const current = guard.begin(repository);

    expect(
      await guard.commit(repository, stale, {
        codeowners: 'stale',
        attributes: 'stale',
      }),
    ).toBe(false);
    expect(
      await guard.commit(repository, current, {
        codeowners: 'current',
        attributes: 'current',
      }),
    ).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(repository, {
      codeowners: 'current',
      attributes: 'current',
    });
  });
});
