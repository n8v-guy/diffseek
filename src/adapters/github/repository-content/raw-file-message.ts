import { isRecord, recordField } from '@diffseek/browser/record';

import {
  isRawFileRequest,
  type RawFileRequest,
  type RawFileResult,
} from './raw-file';

export const rawFileMessageType = 'diffseek:read-raw-file';

export interface RawFileMessage {
  request: RawFileRequest;
  type: typeof rawFileMessageType;
}

export type RawFileMessageResult =
  | RawFileResult
  | { message: string; status: 'error'; };

export function isRawFileMessage(value: unknown): value is RawFileMessage {
  return (
    isRecord(value) &&
    recordField(value, 'type') === rawFileMessageType &&
    isRawFileRequest(recordField(value, 'request'))
  );
}
