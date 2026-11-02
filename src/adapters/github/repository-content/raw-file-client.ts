import { browser } from 'wxt/browser';

import type { RawFileRequest, RawFileResult } from './raw-file';

import {
  type RawFileMessage,
  type RawFileMessageResult,
  rawFileMessageType,
} from './raw-file-message';

export async function readRawFile(
  request: RawFileRequest,
): Promise<RawFileResult> {
  const message: RawFileMessage = { request, type: rawFileMessageType };
  const result = await browser.runtime.sendMessage<
    RawFileMessage,
    RawFileMessageResult
  >(message);
  if (result.status === 'error') throw new Error(result.message);
  return result;
}
