import { fetchRawFile } from './raw-file';
import {
  isRawFileMessage,
  type RawFileMessageResult,
} from './raw-file-message';

export async function handleRawFileMessage(
  message: unknown,
  request: typeof fetch = fetch,
): Promise<RawFileMessageResult | undefined> {
  if (!isRawFileMessage(message)) return undefined;
  try {
    return await fetchRawFile(message.request, request);
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : 'Raw file request failed',
      status: 'error',
    };
  }
}
