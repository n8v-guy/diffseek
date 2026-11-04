export type RepositoryRef = {
  owner: string;
  repo: string;
};

export type RepositoryMetadata = {
  codeowners: string;
  attributes: string;
  /** Directory-scoped files; an empty string also records a missing file. */
  nestedAttributes?: Record<string, string>;
  codeownersPath?: string;
};
