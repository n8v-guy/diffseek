export type PullHeadRequest = {
  repo: string;
  pull: number;
};

export function isPullHeadRequest(value: unknown): value is PullHeadRequest {
  return (
    isRecord(value) &&
    typeof value.repo === 'string' &&
    typeof value.pull === 'number'
  );
}

export function pullCommitsUrl(request: PullHeadRequest): string {
  const repository = request.repo.split('/');
  if (
    repository.length !== 2 ||
    repository.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\\'),
    ) ||
    !Number.isSafeInteger(request.pull) ||
    request.pull < 1
  ) {
    throw new Error('Invalid pull head request');
  }
  return `https://github.com/${repository
    .map(encodeURIComponent)
    .join('/')}/pull/${request.pull}/commits`;
}

export async function fetchPullHead(
  input: PullHeadRequest,
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await request(pullCommitsUrl(input), {
    credentials: 'include',
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Pull head request failed with ${response.status}`);
  }
  const commits = [
    ...(await response.text()).matchAll(/"oid":"([0-9a-f]{40})"/g),
  ];
  const oid = commits.at(-1)?.[1];
  if (!oid) throw new Error('Pull head commit is unavailable');
  return oid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
