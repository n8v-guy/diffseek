import { isRecord } from '@diffseek/browser/record';

import { isPullHeadRequest, type PullHeadRequest } from './pull-head';

export const pullHeadMessageType = 'diffseek:resolve-pull-head';

export interface PullHeadMessage {
  request: PullHeadRequest;
  type: typeof pullHeadMessageType;
}

export type PullHeadMessageResult =
  | { message: string; status: 'error'; }
  | { oid: string; status: 'found'; };

export function isPullHeadMessage(value: unknown): value is PullHeadMessage {
  return (
    isRecord(value) &&
    value['type'] === pullHeadMessageType &&
    isPullHeadRequest(value['request'])
  );
}
