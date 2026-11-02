import { describe, expect, it, vi } from 'vitest';

import { MetadataCommitGuard } from './commit-guard';
import type { RepositoryMetadata, RepositoryRef } from './metadata';

const repository = { owner: 'owner', repo: 'repo' };

describe('MetadataCommitGuard', () => {
  it('drops an older refresh queued after a newer review session starts', async () => {
    const write = vi.fn<
      (repository: RepositoryRef, metadata: RepositoryMetadata) => Promise<void>
    >().mockResolvedValue(undefined);
    const guard = new MetadataCommitGuard(write);
    const stale = guard.begin(repository);
    const current = guard.begin(repository);

    expect(
      await guard.commit(repository, stale, {
        attributes: 'stale',
        codeowners: 'stale',
      }),
    ).toBe(false);
    expect(
      await guard.commit(repository, current, {
        attributes: 'current',
        codeowners: 'current',
      }),
    ).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(repository, {
      attributes: 'current',
      codeowners: 'current',
    });
  });
});
