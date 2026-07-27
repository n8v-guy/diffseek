export type RawFileRequest = {
  repo: string;
  ref: string;
  path: string;
};

export type RawFileResult =
  | {
      status: 'found';
      text: string;
      contentType: string | null;
      url: string;
    }
  | { status: 'missing' };

export function isRawFileRequest(value: unknown): value is RawFileRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.repo === 'string' &&
    typeof value.ref === 'string' &&
    typeof value.path === 'string'
  );
}

export function rawFileUrl(request: RawFileRequest): string {
  const repository = validSegments(request.repo, 2);
  const ref = validSegments(request.ref);
  const path = validSegments(request.path);
  if (!repository || !ref || !path) {
    throw new Error('Invalid raw file request');
  }
  return [
    'https://github.com',
    repository.map(encodeURIComponent).join('/'),
    'raw',
    encodeURIComponent(request.ref),
    path.map(encodeURIComponent).join('/'),
  ].join('/');
}

export async function fetchRawFile(
  input: RawFileRequest,
  request: typeof fetch = fetch,
): Promise<RawFileResult> {
  const response = await request(rawFileUrl(input), {
    credentials: 'include',
    redirect: 'follow',
  });
  if (response.status === 404) return { status: 'missing' };
  if (!response.ok) {
    throw new Error(`Raw file request failed with ${response.status}`);
  }
  return {
    status: 'found',
    text: await response.text(),
    contentType: response.headers.get('content-type'),
    url: response.url,
  };
}

function validSegments(value: string, exact?: number): string[] | null {
  if (
    !value ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\')
  ) {
    return null;
  }
  const segments = value.split('/');
  if (
    (exact != null && segments.length !== exact) ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..',
    )
  ) {
    return null;
  }
  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
