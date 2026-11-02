import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { handlePullHeadMessage } from './pull-head-background';
import { resolvePullHead } from './pull-head-client';

describe('pull head messaging', () => {
  beforeEach(() => { fakeBrowser.reset(); });

  it('resolves the authenticated patch response in the background', async () => {
    await expect(
      handlePullHeadMessage(
        {
          request: { pull: 42, repo: 'owner/repo' },
          type: 'diffseek:resolve-pull-head',
        },
        () => Promise.resolve(new Response(
          `{"oid":"${'a'.repeat(40)}"}`,
        )),
      ),
    ).resolves.toStrictEqual({ oid: 'a'.repeat(40), status: 'found' });
  });

  it('returns the typed background result to the client', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message: unknown, _sender, sendResponse) => {
      sendResponse({
        oid: 'b'.repeat(40),
        status: 'found',
      });
      return true;
    });

    await expect(
      resolvePullHead({ pull: 42, repo: 'owner/repo' }),
    ).resolves.toBe('b'.repeat(40));
  });
});
