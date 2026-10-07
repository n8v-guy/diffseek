import type { LabelFacet } from '../classification/labels';
import type { FileRecord, FilterState } from '../model/file';

import { matchesFilters } from './filters';

export type FacetProjection = {
  hiddenViewedPaths: string[];
  paths: string[];
  total: number;
  viewed: boolean;
  visible: number;
};

export function projectFacet(
  facet: LabelFacet,
  files: readonly FileRecord[],
  filters: FilterState,
): Map<string, FacetProjection> {
  const viewedHidden =
    facet !== 'viewed' && filters.get('viewed')?.has('true') === true;
  const filtersWithoutViewed = viewedHidden
    ? withoutViewedExclusion(filters)
    : filters;
  const projections = new Map<
    string,
    Omit<FacetProjection, 'viewed'>
  >();
  for (const file of files) {
    const values = new Set(
      file.labels
        .filter((label) => label.facet === facet)
        .map((label) => label.value),
    );
    const visible = matchesFilters(file, filters);
    for (const value of values) {
      const projection = projections.get(value) ?? {
        hiddenViewedPaths: [],
        paths: [],
        total: 0,
        visible: 0,
      };
      projection.total += 1;
      if (visible) {
        projection.visible += 1;
        if (file.capabilities.viewed) projection.paths.push(file.path);
      }
      if (
        viewedHidden &&
        !visible &&
        file.viewed &&
        file.capabilities.viewed &&
        matchesFilters(file, filtersWithoutViewed)
      ) {
        projection.hiddenViewedPaths.push(file.path);
      }
      projections.set(value, projection);
    }
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  return new Map(
    [...projections].map(([value, projection]) => [
      value,
      {
        ...projection,
        viewed:
          projection.paths.length > 0 &&
          projection.paths.every((path) => filesByPath.get(path)?.viewed),
      },
    ]),
  );
}

function withoutViewedExclusion(filters: FilterState): FilterState {
  return new Map(
    [...filters].map(([facet, values]) => [
      facet,
      facet === 'viewed'
        ? new Set([...values].filter((value) => value !== 'true'))
        : values,
    ]),
  );
}
