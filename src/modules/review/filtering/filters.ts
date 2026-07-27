import type { FileRecord, FilterState } from '../model/file';

import { matchesFacets } from './facets';

export function matchesFilters(file: FileRecord, filters: FilterState): boolean {
  return matchesFacets(file.labels, filters);
}
