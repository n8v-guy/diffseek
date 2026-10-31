import type { LabelFacet } from '../classification/labels';
import type { FileRecord, FilterState } from '../model/file';

import { matchesFilters } from './filters';
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
  hidden: number;
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
      hiddenUnread: number;
      hiddenCounted: number;
    }
  >();
  for (const file of files) {
    const values = new Set(
      file.labels
        .filter((label) => label.facet === facet)
        .map((label) => label.value),
    );
    const visible = matchesFilters(file, filters);
    const counted = file.capabilities.viewed;
    for (const value of values) {
      const row = rows.get(value) ?? {
        total: 0,
        visible: 0,
        bucket: emptyCountBucket(),
        hiddenUnread: 0,
        hiddenCounted: 0,
      };
      row.total += 1;
      if (visible) row.visible += 1;
      if (counted) addCountedFile(row.bucket, file);
      if (counted && !visible) {
        row.hiddenCounted += 1;
        row.hiddenUnread += file.viewed ? 0 : 1;
      }
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
          hidden: viewedState === 'filled' ? row.hiddenCounted : row.hiddenUnread,
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
