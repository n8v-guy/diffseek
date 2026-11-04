import { browser } from 'wxt/browser';

import type {
  MetadataSearchRequest,
  MetadataSearchResult,
} from './metadata-search';
import {
  metadataSearchMessageType,
  type MetadataSearchMessage,
  type MetadataSearchMessageResult,
} from './metadata-search-background';

export type { MetadataSearchResult };

export async function searchMetadataFiles(
  request: MetadataSearchRequest,
): Promise<MetadataSearchResult> {
  const message: MetadataSearchMessage = {
    type: metadataSearchMessageType,
    request,
  };
  const result = await browser.runtime.sendMessage<
    MetadataSearchMessage,
    MetadataSearchMessageResult
  >(message);
  if (result.status === 'error') throw new Error(result.message);
  return result.files;
}
