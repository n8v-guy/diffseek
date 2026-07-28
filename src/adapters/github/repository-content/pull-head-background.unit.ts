import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { handlePullHeadMessage } from './pull-head-background';
import { resolvePullHead } from './pull-head-client';

describe('pull head messaging', () => {
  beforeEach(() => fakeBrowser.reset());

  it('resolves the authenticated patch response in the background', async () => {
    await expect(
      handlePullHeadMessage(
        {
          type: 'diffseek:resolve-pull-head',
          request: { repo: 'owner/repo', pull: 42 },
        },
        async () =>
          new Response(
            `{"oid":"${'a'.repeat(40)}"}`,
          ),
      ),
    ).resolves.toEqual({ status: 'found', oid: 'a'.repeat(40) });
  });

  it('returns the typed background result to the client', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({
        status: 'found',
        oid: 'b'.repeat(40),
      });
      return true;
    });

    await expect(
      resolvePullHead({ repo: 'owner/repo', pull: 42 }),
    ).resolves.toBe('b'.repeat(40));
  });
});
