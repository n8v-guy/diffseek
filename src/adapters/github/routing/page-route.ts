export interface ReviewRef {
  key: string;
  owner: string;
  pull: number;
  repo: string;
}

const changesFilesPath = /^\/([^\/]+)\/([^\/]+)\/pull\/(\d+)\/changes\/?$/v;
const classicFilesPath = /^\/([^\/]+)\/([^\/]+)\/pull\/(\d+)\/files\/?$/v;
const changesQuery = 'new_files_changed=true';

interface PathParts {
  owner: string;
  pull: string;
  repo: string;
}

/**
 * GitHub sends visitors who cannot use the changes route back to
 * `/files?new_files_changed=true`; redirecting again would loop.
 */
export function changesPathFromClassic(
  pathname: string,
  search = '',
): null | string {
  if (new URLSearchParams(search).get('new_files_changed') === 'true') {
    return null;
  }
  const parts = pathParts(pathname, classicFilesPath);
  if (!parts) return null;
  return `/${parts.owner}/${parts.repo}/pull/${parts.pull}/changes?${changesQuery}`;
}

export function isReviewFilesPath(pathname: string): boolean {
  return reviewFromPath(pathname) !== null;
}

export function reviewFromPath(pathname: string): null | ReviewRef {
  const parts = pathParts(pathname, changesFilesPath);
  if (!parts) return null;
  const pull = Number(parts.pull);
  return {
    key: `${parts.owner}/${parts.repo}#${String(pull)}`,
    owner: parts.owner,
    pull,
    repo: parts.repo,
  };
}

function pathParts(pathname: string, pattern: RegExp): null | PathParts {
  const match = pattern.exec(pathname);
  if (match === null) return null;
  const [, owner, repo, pull] = match;
  if (owner === undefined || repo === undefined || pull === undefined) {
    return null;
  }
  return { owner, pull, repo };
}
