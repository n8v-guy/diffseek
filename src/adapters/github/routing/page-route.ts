export type ReviewRef = {
  owner: string;
  repo: string;
  pull: number;
  key: string;
};

export function isReviewFilesPath(pathname: string): boolean {
  return reviewFromPath(pathname) != null;
}

export function changesPathFromClassic(pathname: string): string | null {
  const match = pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/files\/?$/,
  );
  if (!match) return null;
  return `/${match[1]}/${match[2]}/pull/${match[3]}/changes?new_files_changed=true`;
}

export function reviewFromPath(pathname: string): ReviewRef | null {
  const match = pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/changes\/?$/,
  );
  if (!match) return null;
  const owner = match[1]!;
  const repo = match[2]!;
  const pull = Number(match[3]);
  return { owner, repo, pull, key: `${owner}/${repo}#${pull}` };
}
