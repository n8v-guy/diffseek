import {
  fetchRawFile,
  isRawFileRequest,
  type RawFileRequest,
  type RawFileResult,
} from './raw-file';

export const rawFileMessageType = 'diffseek:read-raw-file';

export type RawFileMessage = {
  type: typeof rawFileMessageType;
  request: RawFileRequest;
};

export type RawFileMessageResult =
  | RawFileResult
  | { status: 'error'; message: string };

export async function handleRawFileMessage(
  message: unknown,
  request: typeof fetch = fetch,
): Promise<RawFileMessageResult | undefined> {
  if (!isRawFileMessage(message)) return undefined;
  try {
    return await fetchRawFile(message.request, request);
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Raw file request failed',
    };
  }
}

function isRawFileMessage(value: unknown): value is RawFileMessage {
  return (
    isRecord(value) &&
    value.type === rawFileMessageType &&
    isRawFileRequest(value.request)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
