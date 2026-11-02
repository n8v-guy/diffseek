import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { handleRawFileMessage } from './raw-file-background';
import { readRawFile } from './raw-file-client';

describe('raw file messaging', () => {
  beforeEach(() => { fakeBrowser.reset(); });

  it('ignores unrelated messages', async () => {
    await expect(
      handleRawFileMessage({ type: 'other' }, () => Promise.resolve(new Response('no'))),
    ).resolves.toBeUndefined();
  });

  it('serializes fetch failures', async () => {
    await expect(
      handleRawFileMessage(
        {
          request: { path: 'CODEOWNERS', ref: 'HEAD', repo: 'owner/repo' },
          type: 'diffseek:read-raw-file',
        },
        () => Promise.resolve(new Response('', { status: 500 })),
      ),
    ).resolves.toStrictEqual({
      message: 'Raw file request failed with 500',
      status: 'error',
    });
  });

  it('returns the typed background result to the client', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message: unknown, _sender, sendResponse) => {
      sendResponse({
        contentType: 'text/plain',
        status: 'found',
        text: '*.ts @owner',
        url: 'https://raw.githubusercontent.com/owner/repo/HEAD/CODEOWNERS',
      });
      return true;
    });

    await expect(
      readRawFile({ path: 'CODEOWNERS', ref: 'HEAD', repo: 'owner/repo' }),
    ).resolves.toMatchObject({ status: 'found', text: '*.ts @owner' });
  });

  it('turns a serialized background failure into a rejected client request', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message: unknown, _sender, sendResponse) => {
      sendResponse({
        message: 'offline',
        status: 'error',
      });
      return true;
    });

    await expect(
      readRawFile({ path: 'CODEOWNERS', ref: 'HEAD', repo: 'owner/repo' }),
    ).rejects.toThrow('offline');
  });
});
