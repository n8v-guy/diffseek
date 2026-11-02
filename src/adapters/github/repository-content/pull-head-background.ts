import { fetchPullHead } from './pull-head';
import {
  isPullHeadMessage,
  type PullHeadMessageResult,
} from './pull-head-message';

export async function handlePullHeadMessage(
  message: unknown,
  request: typeof fetch = fetch,
): Promise<PullHeadMessageResult | undefined> {
  if (!isPullHeadMessage(message)) return undefined;
  try {
    return {
      oid: await fetchPullHead(message.request, request),
      status: 'found',
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : 'Pull head request failed',
      status: 'error',
    };
  }
}
