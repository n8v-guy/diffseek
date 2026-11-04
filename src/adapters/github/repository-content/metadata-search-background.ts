import { isRecord } from '@diffseek/browser';

import {
  fetchMetadataSearch,
  isMetadataSearchRequest,
  type MetadataSearchRequest,
  type MetadataSearchResult,
} from './metadata-search';

export const metadataSearchMessageType = 'diffseek:search-metadata';

export type MetadataSearchMessage = {
  type: typeof metadataSearchMessageType;
  request: MetadataSearchRequest;
};

export type MetadataSearchMessageResult =
  | { status: 'found'; files: MetadataSearchResult }
  | { status: 'error'; message: string };

export async function handleMetadataSearchMessage(
  message: unknown,
  request: typeof fetch = fetch,
): Promise<MetadataSearchMessageResult | undefined> {
  if (!isMetadataSearchMessage(message)) return undefined;
  try {
    return {
      status: 'found',
      files: await fetchMetadataSearch(message.request, request),
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Metadata search failed',
    };
  }
}

function isMetadataSearchMessage(value: unknown): value is MetadataSearchMessage {
  return (
    isRecord(value) &&
    value.type === metadataSearchMessageType &&
    isMetadataSearchRequest(value.request)
  );
}
