
import { browser } from 'wxt/browser';

import { handlePullHeadMessage } from '@diffseek/github/repository-content/pull-head-background';
import { handleRawFileMessage } from '@diffseek/github/repository-content/raw-file-background';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      const raw = await handleRawFileMessage(message);
      const pull = raw == null
        ? await handlePullHeadMessage(message)
        : undefined;
      return raw ?? pull;
    })().then(sendResponse);
    return true;
  });
});
