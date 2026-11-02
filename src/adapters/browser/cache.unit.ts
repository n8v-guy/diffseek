import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  readCache,
  readPullCache,
  writeCache,
  writePullCache,
} from './cache';

const repository = { owner: 'owner', repo: 'repo' };
const sha = 'a'.repeat(40);
const metadata = {
  attributes: '*.ts group=code',
  codeowners: '*.ts @team',
  codeownersPath: 'CODEOWNERS',
};

describe('metadata cache', () => {
  beforeEach(() => { fakeBrowser.reset(); });

  it('round-trips default-branch metadata', async () => {
    await writeCache(repository, metadata);
    await expect(readCache(repository)).resolves.toStrictEqual(metadata);
  });

  it('keeps the 10 most recent pull requests and evicts the oldest', async () => {
    await rememberPulls(1);

    await expect(
      readPullCache({ ...repository, pull: 1 }),
    ).resolves.toBeNull();
    await expect(readPullCache({ ...repository, pull: 2 })).resolves.toStrictEqual({
      ...metadata,
      codeowners: '*.ts @p2',
      sha,
    });
    await expect(readPullCache({ ...repository, pull: 11 })).resolves.toStrictEqual({
      ...metadata,
      codeowners: '*.ts @p11',
      sha,
    });
  });

  it('moves a rewritten pull request to the front without duplicating it', async () => {
    await writePullCache({ ...repository, pull: 1 }, sha, metadata);
    await writePullCache(
      { ...repository, pull: 2 },
      sha,
      { ...metadata, codeowners: '*.ts @p2' },
    );
    await writePullCache(
      { ...repository, pull: 1 },
      'b'.repeat(40),
      { ...metadata, codeowners: '*.ts @fresh' },
    );

    await rememberPulls(3);

    await expect(readPullCache({ ...repository, pull: 1 })).resolves.toStrictEqual({
      ...metadata,
      codeowners: '*.ts @fresh',
      sha: 'b'.repeat(40),
    });
    await expect(
      readPullCache({ ...repository, pull: 2 }),
    ).resolves.toBeNull();
  });
});

async function rememberPulls(from: number): Promise<void> {
  const newestPull = 11;
  for (let pull = from; pull <= newestPull; pull += 1) {
    await writePullCache(
      { ...repository, pull },
      sha,
      { ...metadata, codeowners: `*.ts @p${String(pull)}` },
    );
  }
}
