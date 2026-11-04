import { isRecord } from '@diffseek/browser';

import { validSegments } from './raw-file';

export type MetadataSearchRequest = { repo: string };
export type MetadataSearchResult = { path: string; blob: string }[];

/** Failure guard only: a hung request never settles and nothing signals it. */
const searchTimeoutMs = 20_000;
/** A repository with more matches is not worth paging through. */
const maxSearchPages = 10;
const unusable = 'Metadata search is unavailable';

export function isMetadataSearchRequest(
  value: unknown,
): value is MetadataSearchRequest {
  return isRecord(value) && typeof value.repo === 'string';
}

/** Throws when search cannot be trusted: errors, signed out, unindexed, or odd data. */
export async function fetchMetadataSearch(
  input: MetadataSearchRequest,
  request: typeof fetch = fetch,
): Promise<MetadataSearchResult> {
  if (!validSegments(input.repo, 2)) {
    throw new Error('Invalid metadata search request');
  }
  const query = encodeURIComponent(
    `repo:${input.repo} (path:**/.gitattributes OR path:**/CODEOWNERS)`,
  );
  const files: MetadataSearchResult = [];
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const paging = page > 1 ? `&p=${page}` : '';
    const route = await fetchRoute(
      `https://github.com/search?type=code&q=${query}${paging}`,
      request,
    );
    files.push(...resultsOf(route));
    pages = typeof route.page_count === 'number' ? route.page_count : 1;
    if (pages > maxSearchPages) throw new Error(unusable);
  }
  if (files.length === 0) throw new Error(unusable);
  return files;
}

async function fetchRoute(
  url: string,
  request: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await request(url, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(searchTimeoutMs),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error(unusable);
  }
  const body: unknown = await response.json();
  const payload = isRecord(body) ? body.payload : undefined;
  const route = isRecord(payload) ? payload.blackbirdSearchRoute : undefined;
  if (!isRecord(route)) throw new Error(unusable);
  return route;
}

function resultsOf(route: Record<string, unknown>): MetadataSearchResult {
  const { results, errors } = route;
  const clean = errors == null || (Array.isArray(errors) && errors.length === 0);
  if (!clean || !Array.isArray(results)) throw new Error(unusable);
  return results.map((result: unknown) => {
    if (
      !isRecord(result) ||
      typeof result.path !== 'string' ||
      typeof result.blob_sha !== 'string'
    ) {
      throw new TypeError(unusable);
    }
    return { path: result.path, blob: result.blob_sha };
  });
}
