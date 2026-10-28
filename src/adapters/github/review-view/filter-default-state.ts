import {
  type FilterDefaults,
  type FilterDefaultState,
  type RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import type { LabelFacet } from '@diffseek/review';

export type FilterDefaultOptions = {
  facet: LabelFacet;
  value: string;
  excluded: Set<string>;
  filterDefaults?: FilterDefaults;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
};

export function applyCheckedState(
  item: HTMLButtonElement,
  options: FilterDefaultOptions,
): void {
  const remembered =
    isRememberedFilterFacet(options.facet) &&
    options.filterDefaults?.hidden.has(options.facet);
  item.setAttribute(
    'aria-checked',
    remembered
      ? 'mixed'
      : String(!options.excluded.has(options.value)),
  );
}

export function cycleFilterDefault(options: FilterDefaultOptions): boolean {
  const defaults = options.filterDefaults;
  if (!isRememberedFilterFacet(options.facet) || !defaults) return false;
  if (defaults.hidden.has(options.facet)) {
    defaults.hidden.delete(options.facet);
    options.excluded.delete(options.value);
    options.onFilterDefaultChange?.(options.facet, 'shown');
    return true;
  }
  if (options.excluded.has(options.value)) {
    defaults.hidden.add(options.facet);
    options.onFilterDefaultChange?.(options.facet, 'hidden');
    return true;
  }
  options.excluded.add(options.value);
  return true;
}

function isRememberedFilterFacet(
  facet: LabelFacet,
): facet is RememberedFilterFacet {
  return facet === 'viewed' || facet === 'generated';
}
