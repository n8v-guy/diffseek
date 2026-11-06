import { sendExtensionMessage } from './extension-message';
import type { PullHeadRequest } from './pull-head';
import {
  pullHeadMessageType,
  type PullHeadMessage,
  type PullHeadMessageResult,
} from './pull-head-background';

const pendingHeads = new Map<string, Promise<string>>();

/** One in-flight lookup per pull. A failure is not reused. */
export function resolvePullHead(request: PullHeadRequest): Promise<string> {
  const key = `${request.repo}#${request.pull}`;
  const current = pendingHeads.get(key);
  if (current) return current;
  const pending = requestPullHead(request).finally(() => {
    if (pendingHeads.get(key) === pending) pendingHeads.delete(key);
  });
  pendingHeads.set(key, pending);
  return pending;
}

async function requestPullHead(request: PullHeadRequest): Promise<string> {
  const message: PullHeadMessage = { type: pullHeadMessageType, request };
  const result = await sendExtensionMessage<PullHeadMessageResult>(message);
  if (result.status === 'error') throw new Error(result.message);
  return result.oid;
}
