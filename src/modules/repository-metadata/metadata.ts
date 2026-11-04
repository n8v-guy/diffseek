export type RepositoryRef = {
  owner: string;
  repo: string;
};

export type RepositoryMetadata = {
  codeowners: string;
  attributes: string;
  /** Directory-scoped files. */
  nestedAttributes?: Record<string, string>;
};
