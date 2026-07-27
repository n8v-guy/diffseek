import {
  fetchPullHead,
  isPullHeadRequest,
  type PullHeadRequest,
} from './pull-head';

export const pullHeadMessageType = 'diffseek:resolve-pull-head';

export type PullHeadMessage = {
  type: typeof pullHeadMessageType;
  request: PullHeadRequest;
};

export type PullHeadMessageResult =
  | { status: 'found'; oid: string }
  | { status: 'error'; message: string };

export async function handlePullHeadMessage(
  message: unknown,
  request: typeof fetch = fetch,
): Promise<PullHeadMessageResult | undefined> {
  if (!isPullHeadMessage(message)) return undefined;
  try {
    return {
      status: 'found',
      oid: await fetchPullHead(message.request, request),
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Pull head request failed',
    };
  }
}

function isPullHeadMessage(value: unknown): value is PullHeadMessage {
  return (
    isRecord(value) &&
    value.type === pullHeadMessageType &&
    isPullHeadRequest(value.request)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
