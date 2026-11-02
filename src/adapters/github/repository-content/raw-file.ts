import { isRecord } from '@diffseek/browser/record';

const notFoundStatus = 404;
const rawFileTimeoutMs = 20_000;

export interface RawFileRequest {
  path: string;
  ref: string;
  repo: string;
}

export type RawFileResult =
  | {
      contentType: null | string;
      status: 'found';
      text: string;
      url: string;
    }
  | { status: 'missing' };

/** Failure guard only: a hung request never settles and nothing signals it. */
export async function fetchRawFile(
  input: RawFileRequest,
  request: typeof fetch = fetch,
): Promise<RawFileResult> {
  const response = await request(rawFileUrl(input), {
    credentials: 'include',
    redirect: 'follow',
    signal: AbortSignal.timeout(rawFileTimeoutMs),
  });
  if (response.status === notFoundStatus) return { status: 'missing' };
  if (!response.ok) {
    throw new Error(`Raw file request failed with ${response.status}`);
  }
  return {
    contentType: response.headers.get('content-type'),
    status: 'found',
    text: await response.text(),
    url: response.url,
  };
}

export function isRawFileRequest(value: unknown): value is RawFileRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value['repo'] === 'string' &&
    typeof value['ref'] === 'string' &&
    typeof value['path'] === 'string'
  );
}

export function rawFileUrl(request: RawFileRequest): string {
  const repository = validSegments(request.repo, 2);
  const ref = validSegments(request.ref);
  const path = validSegments(request.path);
  if (repository === null || ref === null || path === null) {
    throw new Error('Invalid raw file request');
  }
  return [
    'https://github.com',
    repository.map((segment) => encodeURIComponent(segment)).join('/'),
    'raw',
    encodeURIComponent(request.ref),
    path.map((segment) => encodeURIComponent(segment)).join('/'),
  ].join('/');
}

function isPathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..';
}

function isWrongSegmentCount(segments: string[], exact?: number): boolean {
  return typeof exact === 'number' && segments.length !== exact;
}

function validSegments(value: string, exact?: number): null | string[] {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\')
  ) {
    return null;
  }
  const segments = value.split('/');
  if (
    isWrongSegmentCount(segments, exact) ||
    segments.some((segment) => !isPathSegment(segment))
  ) {
    return null;
  }
  return segments;
}
