import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { handleMetadataSearchMessage } from './metadata-search-background';
import { searchMetadataFiles } from './metadata-search-client';

const message = {
  type: 'diffseek:search-metadata',
  request: { repo: 'owner/repo' },
};

describe('metadata search messaging', () => {
  beforeEach(() => fakeBrowser.reset());

  it('searches in the background and reports failures as typed errors', async () => {
    await expect(
      handleMetadataSearchMessage(
        message,
        async () =>
          new Response(
            JSON.stringify({
              payload: {
                blackbirdSearchRoute: {
                  results: [{ path: 'CODEOWNERS', blob_sha: 'a' }],
                  errors: [],
                },
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    ).resolves.toEqual({ status: 'found', files: [{ path: 'CODEOWNERS', blob: 'a' }] });
    await expect(
      handleMetadataSearchMessage(message, async () => new Response('', { status: 500 })),
    ).resolves.toMatchObject({ status: 'error' });
    await expect(handleMetadataSearchMessage({ type: 'other' })).resolves.toBeUndefined();
  });

  it('returns the typed background result to the client', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ status: 'found', files: [{ path: 'CODEOWNERS', blob: 'a' }] });
      return true;
    });
    await expect(searchMetadataFiles({ repo: 'owner/repo' })).resolves.toEqual([
      { path: 'CODEOWNERS', blob: 'a' },
    ]);
  });

  it('rejects when the background reports an error', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ status: 'error', message: 'Metadata search is unavailable' });
      return true;
    });
    await expect(searchMetadataFiles({ repo: 'owner/repo' })).rejects.toThrow(
      'Metadata search is unavailable',
    );
  });
});
