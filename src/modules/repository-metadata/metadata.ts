export interface RepositoryMetadata {
  attributes: string;
  codeowners: string;
  codeownersPath?: string;
}

export interface RepositoryRef {
  owner: string;
  repo: string;
}
