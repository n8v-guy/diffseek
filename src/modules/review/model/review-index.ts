import type { FileRecord } from './file';

export class ReviewIndex {
  private readonly descendants = new Map<string, FileRecord[]>();

  constructor(files: FileRecord[]) {
    for (const file of files) {
      for (const item of ancestors(file.path)) {
        const matches = this.descendants.get(item) ?? [];
        matches.push(file);
        this.descendants.set(item, matches);
      }
    }
  }

  filesUnder(item: string): readonly FileRecord[] {
    return this.descendants.get(item) ?? [];
  }

  visibleItems(paths: Iterable<string>): Set<string> {
    const visible = new Set<string>();
    for (const path of paths) {
      for (const item of ancestors(path)) visible.add(item);
    }
    return visible;
  }
}

function ancestors(path: string): string[] {
  const segments = path.split('/');
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}
