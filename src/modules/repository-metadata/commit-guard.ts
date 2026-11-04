import type { RepositoryRef } from './metadata';

type WriteMetadata<T> = (
  repository: RepositoryRef,
  metadata: T,
) => Promise<void>;

export class MetadataCommitGuard<T> {
  private readonly revisions = new Map<string, number>();
  private readonly tails = new Map<string, Promise<unknown>>();

  private readonly write: WriteMetadata<T>;

  constructor(write: WriteMetadata<T>) {
    this.write = write;
  }

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
    metadata: T,
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
