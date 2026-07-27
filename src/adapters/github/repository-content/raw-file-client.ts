import { browser } from 'wxt/browser';

import type { RawFileRequest, RawFileResult } from './raw-file';
import {
  rawFileMessageType,
  type RawFileMessage,
  type RawFileMessageResult,
} from './raw-file-background';

export async function readRawFile(
  request: RawFileRequest,
): Promise<RawFileResult> {
  const message: RawFileMessage = { type: rawFileMessageType, request };
  const result = await browser.runtime.sendMessage<
    RawFileMessage,
    RawFileMessageResult
  >(message);
  if (result.status === 'error') throw new Error(result.message);
  return result;
}
