import type { LabelFacet } from '../classification/labels';
import type { FileRecord, FilterState } from '../model/file';

import { matchesFacets } from './facets';
import {
  addCountedFile,
  bucketActionPaths,
  emptyCountBucket,
  viewedMark,
  type CountBucket,
  type ViewedMark,
} from './viewed-scope';

export type FacetProjection = {
  counted: number;
  paths: string[];
  total: number;
  viewedCount: number;
  viewedState: ViewedMark;
  visible: number;
};

export function projectFacet(
  facet: LabelFacet,
  files: readonly FileRecord[],
  filters: FilterState,
): Map<string, FacetProjection> {
  const rows = new Map<
    string,
    {
      total: number;
      visible: number;
      bucket: CountBucket;
    }
  >();
  for (const file of files) {
    const values = new Set(
      file.labels
        .filter((label) => label.facet === facet)
        .map((label) => label.value),
    );
    const visible = matchesFacets(file.labels, filters);
    const counted = file.capabilities.viewed;
    for (const value of values) {
      const row = rows.get(value) ?? {
        total: 0,
        visible: 0,
        bucket: emptyCountBucket(),
      };
      row.total += 1;
      if (visible) row.visible += 1;
      if (counted) addCountedFile(row.bucket, file);
      rows.set(value, row);
    }
  }

  return new Map(
    [...rows].map(([value, row]) => {
      const viewedState = viewedMark(row.bucket.viewed, row.bucket.counted);
      return [
        value,
        {
          counted: row.bucket.counted,
          paths: bucketActionPaths(row.bucket),
          total: row.total,
          viewedCount: row.bucket.viewed,
          viewedState,
          visible: row.visible,
        },
      ];
    }),
  );
}
