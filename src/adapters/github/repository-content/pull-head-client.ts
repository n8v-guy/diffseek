import { browser } from 'wxt/browser';

import type { PullHeadRequest } from './pull-head';
import {
  pullHeadMessageType,
  type PullHeadMessage,
  type PullHeadMessageResult,
} from './pull-head-background';

export async function resolvePullHead(
  request: PullHeadRequest,
): Promise<string> {
  const message: PullHeadMessage = { type: pullHeadMessageType, request };
  const result = await browser.runtime.sendMessage<
    PullHeadMessage,
    PullHeadMessageResult
  >(message);
  if (result.status === 'error') throw new Error(result.message);
  return result.oid;
}
