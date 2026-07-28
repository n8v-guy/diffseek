import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { handleRawFileMessage } from './raw-file-background';
import { readRawFile } from './raw-file-client';

describe('raw file messaging', () => {
  beforeEach(() => fakeBrowser.reset());

  it('ignores unrelated messages', async () => {
    await expect(
      handleRawFileMessage({ type: 'other' }, async () => new Response('no')),
    ).resolves.toBeUndefined();
  });

  it('serializes fetch failures', async () => {
    await expect(
      handleRawFileMessage(
        {
          type: 'diffseek:read-raw-file',
          request: { repo: 'owner/repo', ref: 'HEAD', path: 'CODEOWNERS' },
        },
        async () => new Response('', { status: 500 }),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'Raw file request failed with 500',
    });
  });

  it('returns the typed background result to the client', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({
        status: 'found',
        text: '*.ts @owner',
        contentType: 'text/plain',
        url: 'https://raw.githubusercontent.com/owner/repo/HEAD/CODEOWNERS',
      });
      return true;
    });

    await expect(
      readRawFile({ repo: 'owner/repo', ref: 'HEAD', path: 'CODEOWNERS' }),
    ).resolves.toMatchObject({ status: 'found', text: '*.ts @owner' });
  });

  it('turns a serialized background failure into a rejected client request', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({
        status: 'error',
        message: 'offline',
      });
      return true;
    });

    await expect(
      readRawFile({ repo: 'owner/repo', ref: 'HEAD', path: 'CODEOWNERS' }),
    ).rejects.toThrow('offline');
  });
});
