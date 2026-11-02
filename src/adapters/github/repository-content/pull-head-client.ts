import { browser } from 'wxt/browser';

import type { PullHeadRequest } from './pull-head';
import {
  type PullHeadMessage,
  type PullHeadMessageResult,
  pullHeadMessageType,
} from './pull-head-message';

export async function resolvePullHead(
  request: PullHeadRequest,
): Promise<string> {
  const message: PullHeadMessage = { request, type: pullHeadMessageType };
  const result = await browser.runtime.sendMessage<
    PullHeadMessage,
    PullHeadMessageResult
  >(message);
  if (result.status === 'error') throw new Error(result.message);
  return result.oid;
}
