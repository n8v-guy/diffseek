import type { FileRecord } from '../model/file';

export class FileCatalog {
  private readonly records = new Map<string, FileRecord>();

  merge(files: readonly FileRecord[]): void {
    for (const file of files) {
      const existing = this.records.get(file.path);
      if (existing) {
        Object.assign(existing, clone(file));
      } else {
        this.records.set(file.path, clone(file));
      }
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
