import type { RepositoryMetadata, RepositoryRef } from './metadata';

type WriteMetadata = (
  repository: RepositoryRef,
  metadata: RepositoryMetadata,
) => Promise<void>;

export class MetadataCommitGuard {
  private readonly revisions = new Map<string, number>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly write: WriteMetadata;

  constructor(write: WriteMetadata) {
    this.write = write;
  }

  begin(repository: RepositoryRef): number {
    const key = repositoryKey(repository);
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    return revision;
  }

  commit(
    repository: RepositoryRef,
    revision: number,
    metadata: RepositoryMetadata,
  ): Promise<boolean> {
    const key = repositoryKey(repository);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = chain(previous, async () => {
      if (this.revisions.get(key) !== revision) return false;
      await this.write(repository, metadata);
      return true;
    });
    this.tails.set(key, swallow(result));
    return result;
  }

  invalidate(repository: RepositoryRef): void {
    this.begin(repository);
  }
}

async function chain<T>(
  previous: Promise<unknown>,
  task: () => Promise<T>,
): Promise<T> {
  await previous;
  return task();
}

function repositoryKey(repository: RepositoryRef): string {
  return `${repository.owner}/${repository.repo}`;
}

async function swallow(result: Promise<unknown>): Promise<void> {
  try {
    await result;
  } catch {
    return;
  }
}
