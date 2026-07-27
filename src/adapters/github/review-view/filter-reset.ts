import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import type { FilterState, LabelFacet } from '@diffseek/review';

export function hasTransientExclusions(
  filters: FilterState,
  defaults: FilterDefaults | undefined,
): boolean {
  for (const [facet, values] of filters) {
    for (const value of values) {
      if (!isDefaultBacked(facet, value, defaults)) return true;
    }
  }
  return false;
}

export function resetTransientExclusions(
  filters: FilterState,
  defaults: FilterDefaults | undefined,
): void {
  for (const values of filters.values()) values.clear();
  for (const facet of defaults?.hidden ?? []) {
    filters.get(facet)?.add('true');
  }
}

function isDefaultBacked(
  facet: LabelFacet,
  value: string,
  defaults: FilterDefaults | undefined,
): boolean {
  return (
    value === 'true' &&
    (facet === 'viewed' || facet === 'generated') &&
    (defaults?.hidden.has(facet) ?? false)
  );
}
