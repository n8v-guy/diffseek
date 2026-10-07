import type { FileRecord } from '../model/file';

export class FileCatalog {
  private readonly records = new Map<string, FileRecord>();

  merge(files: readonly FileRecord[]): void {
    for (const file of files) {
      const existing = this.records.get(file.path);
      if (!existing) {
        this.records.set(file.path, clone(file));
        continue;
      }
      const next = clone(file);
      // scanPage emits empty labels; keep classification across stub/region churn.
      if (next.labels.length === 0) {
        next.labels = existing.labels.map((label) => ({ ...label }));
        next.generated = existing.generated;
      }
      if (!next.capabilities.viewed) next.viewed = existing.viewed;
      if (next.owners.length === 0) next.owners = [...existing.owners];
      Object.assign(existing, next);
    }
  }

  files(): FileRecord[] {
    return [...this.records.values()];
  }
}

function clone(file: FileRecord): FileRecord {
  return {
    ...file,
    capabilities: { ...file.capabilities },
    labels: file.labels.map((label) => ({ ...label })),
    owners: [...file.owners],
  };
}
