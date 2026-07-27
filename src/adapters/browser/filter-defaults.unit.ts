import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  readFilterDefaults,
  writeFilterDefaults,
} from '@diffseek/browser/filter-defaults';

describe('filter defaults', () => {
  beforeEach(() => fakeBrowser.reset());

  it('stores hidden facets and generated viewed behavior together', async () => {
    await writeFilterDefaults({
      hidden: new Set(['viewed', 'generated']),
      viewed: new Set(['generated']),
    });

    expect(await readFilterDefaults()).toEqual({
      hidden: new Set(['viewed', 'generated']),
      viewed: new Set(['generated']),
    });
    expect(
      await fakeBrowser.storage.local.get('diffseek:filter-defaults'),
    ).toEqual({
      'diffseek:filter-defaults': {
        hidden: ['viewed', 'generated'],
        viewed: ['generated'],
      },
    });
  });

  it('reads the existing hidden-only shape and ignores malformed values', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:filter-defaults': {
        hidden: ['owners', 'viewed', 4],
        viewed: ['owners', 'generated'],
      },
    });
    expect(await readFilterDefaults()).toEqual({
      hidden: new Set(['viewed']),
      viewed: new Set(),
    });

    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    await expect(readFilterDefaults()).resolves.toEqual({
      hidden: new Set(),
      viewed: new Set(),
    });
  });
});
