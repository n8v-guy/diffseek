import { describe, expect, it } from 'vitest';

import {
  changesPathFromClassic,
  isReviewFilesPath,
  reviewFromPath,
} from './page-route';

describe('isReviewFilesPath', () => {
  it('accepts the current GitHub changes route', () => {
    expect(isReviewFilesPath('/owner/repo/pull/1/changes')).toBe(true);
  });

  it('rejects the legacy GitHub files route', () => {
    expect(isReviewFilesPath('/owner/repo/pull/1/files')).toBe(false);
  });

  it('rejects unrelated GitHub routes', () => {
    expect(isReviewFilesPath('/owner/repo/issues/1')).toBe(false);
  });

  it('gives each pull request a distinct review identity', () => {
    expect(reviewFromPath('/owner/repo/pull/41/changes')).toEqual({
      owner: 'owner',
      repo: 'repo',
      pull: 41,
      key: 'owner/repo#41',
    });
    expect(reviewFromPath('/owner/repo/pull/42/files')).toBeNull();
  });
});

describe('changesPathFromClassic', () => {
  it('redirects an exact classic review route to the modern experience', () => {
    expect(changesPathFromClassic('/owner/repo/pull/42/files')).toBe(
      '/owner/repo/pull/42/changes?new_files_changed=true',
    );
    expect(changesPathFromClassic('/owner/repo/pull/42/files/')).toBe(
      '/owner/repo/pull/42/changes?new_files_changed=true',
    );
  });

  it('leaves modern and unrelated routes alone', () => {
    expect(changesPathFromClassic('/owner/repo/pull/42/changes')).toBeNull();
    expect(changesPathFromClassic('/owner/repo/pull/42/files/one')).toBeNull();
  });
});
