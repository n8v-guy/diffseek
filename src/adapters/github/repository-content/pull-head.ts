import { isRecord } from '@diffseek/browser/record';

const commitOidPattern = /"oid":"([0-9a-f]{40})"/gv;
const pullHeadTimeoutMs = 20_000;

export interface PullHeadRequest {
  pull: number;
  repo: string;
}

export async function fetchPullHead(
  input: PullHeadRequest,
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await request(pullCommitsUrl(input), {
    credentials: 'include',
    redirect: 'follow',
    // Failure guard only: a hung request never settles and nothing signals it.
    signal: AbortSignal.timeout(pullHeadTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Pull head request failed with ${String(response.status)}`);
  }
  const commits = (await response.text()).matchAll(commitOidPattern).toArray();
  const oid = commits.at(-1)?.[1];
  if (oid === undefined || oid.length === 0) {
    throw new Error('Pull head commit is unavailable');
  }
  return oid;
}

export function isPullHeadRequest(value: unknown): value is PullHeadRequest {
  return (
    isRecord(value) &&
    typeof value['repo'] === 'string' &&
    typeof value['pull'] === 'number'
  );
}

export function pullCommitsUrl(request: PullHeadRequest): string {
  const repository = request.repo.split('/');
  if (
    repository.length !== 2 ||
    repository.some((segment) => !isRepositorySegment(segment)) ||
    !Number.isSafeInteger(request.pull) ||
    request.pull < 1
  ) {
    throw new Error('Invalid pull head request');
  }
  return `https://github.com/${repository
    .map((segment) => encodeURIComponent(segment))
    .join('/')}/pull/${String(request.pull)}/commits`;
}

function isRepositorySegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('\\')
  );
}
