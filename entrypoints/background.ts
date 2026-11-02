import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { handlePullHeadMessage } from '@diffseek/github/repository-content/pull-head-background';
import { handleRawFileMessage } from '@diffseek/github/repository-content/raw-file-background';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    void (async (): Promise<unknown> => {
      const raw = await handleRawFileMessage(message);
      const pull =
        raw === undefined ? await handlePullHeadMessage(message) : undefined;
      return raw ?? pull;
    })().then(sendResponse);
    return true;
  });
});
