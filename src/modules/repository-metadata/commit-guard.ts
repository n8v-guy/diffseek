import type { RepositoryMetadata, RepositoryRef } from './metadata';

type WriteMetadata = (
  repository: RepositoryRef,
  metadata: RepositoryMetadata,
) => Promise<void>;

export class MetadataCommitGuard {
  private readonly revisions = new Map<string, number>();
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly write: WriteMetadata) {}

  begin(repository: RepositoryRef): number {
    const key = repositoryKey(repository);
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    return revision;
  }

  invalidate(repository: RepositoryRef): void {
    this.begin(repository);
  }

  commit(
    repository: RepositoryRef,
    revision: number,
    metadata: RepositoryMetadata,
  ): Promise<boolean> {
    const key = repositoryKey(repository);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(async () => {
      if (this.revisions.get(key) !== revision) return false;
      await this.write(repository, metadata);
      return true;
    });
    this.tails.set(key, result.catch(() => undefined));
    return result;
  }
}

function repositoryKey(repository: RepositoryRef): string {
  return `${repository.owner}/${repository.repo}`;
}
