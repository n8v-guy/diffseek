import { browser } from 'wxt/browser';

import {
  handlePullHeadMessage,
  handleRawFileMessage,
} from '@diffseek/github';

export function startBackground(): void {
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
}
