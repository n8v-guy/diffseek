import { browser } from 'wxt/browser';

import {
  handleMetadataSearchMessage,
  handlePullHeadMessage,
  handleRawFileMessage,
} from '@diffseek/github';

const handlers = [
  handleRawFileMessage,
  handlePullHeadMessage,
  handleMetadataSearchMessage,
];

export function startBackground(): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      for (const handle of handlers) {
        const result = await handle(message);
        if (result != null) return result;
      }
      return undefined;
    })().then(sendResponse);
    return true;
  });
}
