import {
  addCountedFile,
  emptyCountBucket,
  type CountBucket,
} from '../filtering/viewed-scope';

import type { FileRecord } from './file';

export class ReviewIndex {
  private readonly descendants = new Map<string, FileRecord[]>();

  constructor(private readonly files: readonly FileRecord[]) {
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

  /**
   * One pass over files. Each counted file updates every ancestor folder.
   * The result sums files, not child-folder states.
   */
  folderViewed(include: (file: FileRecord) => boolean): Map<string, CountBucket> {
    const totals = new Map<string, CountBucket>();
    for (const file of this.files) {
      if (!include(file)) continue;
      const segments = file.path.split('/');
      for (let depth = 1; depth < segments.length; depth += 1) {
        const folder = segments.slice(0, depth).join('/');
        let bucket = totals.get(folder);
        if (!bucket) {
          bucket = emptyCountBucket();
          totals.set(folder, bucket);
        }
        addCountedFile(bucket, file);
      }
    }
    return totals;
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
