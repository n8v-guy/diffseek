export type RepositoryRef = {
  owner: string;
  repo: string;
  /** The pull's base branch when it is not the default branch. */
  branch?: string;
};

/** Default-branch metadata and each other base branch's metadata are kept apart. */
export function repositoryKey({ owner, repo, branch }: RepositoryRef): string {
  return branch === undefined ? `${owner}/${repo}` : `${owner}/${repo}@${branch}`;
}

export type RepositoryMetadata = {
  codeowners: string;
  attributes: string;
  /** Directory-scoped files. */
  nestedAttributes?: Record<string, string>;
};
