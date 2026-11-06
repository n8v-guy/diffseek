import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { extensionMessageTimeoutMs } from './extension-message';
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

  it('shares one lookup while it is in flight and retries after it fails', async () => {
    let calls = 0;
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      calls += 1;
      sendResponse(
        calls === 1
          ? { status: 'error', message: 'offline' }
          : { status: 'found', oid: 'c'.repeat(40) },
      );
      return true;
    });
    const request = { repo: 'owner/repo', pull: 7 };
    await expect(Promise.all([
      resolvePullHead(request),
      resolvePullHead(request),
    ])).rejects.toThrow('offline');
    expect(calls).toBe(1);
    await expect(resolvePullHead(request)).resolves.toBe('c'.repeat(40));
    expect(calls).toBe(2);
  });

  it('stops waiting when the service worker never answers', async () => {
    vi.useFakeTimers();
    try {
      fakeBrowser.runtime.onMessage.addListener(() => true);
      const pending = resolvePullHead({ repo: 'owner/repo', pull: 8 }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(extensionMessageTimeoutMs);
      const error = await pending;
      expect(error).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });
});
