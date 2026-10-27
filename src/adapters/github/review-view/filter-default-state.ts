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
  if (
    options.facet === 'generated' &&
    options.filterDefaults?.viewed.has('generated')
  ) {
    item.dataset.defaultViewed = 'true';
  } else {
    delete item.dataset.defaultViewed;
  }
}

export function cycleFilterDefault(options: FilterDefaultOptions): boolean {
  const defaults = options.filterDefaults;
  if (!isRememberedFilterFacet(options.facet) || !defaults) return false;
  if (options.facet === 'generated') cycleGenerated(options, defaults);
  else cycleViewed(options, defaults);
  return true;
}

function cycleGenerated(
  options: FilterDefaultOptions,
  defaults: FilterDefaults,
): void {
  if (defaults.viewed.has('generated')) {
    defaults.viewed.delete('generated');
    options.onFilterDefaultChange?.('generated', 'hidden');
    return;
  }
  if (defaults.hidden.has('generated')) {
    defaults.hidden.delete('generated');
    options.excluded.delete(options.value);
    options.onFilterDefaultChange?.('generated', 'shown');
    return;
  }
  if (options.excluded.has(options.value)) {
    defaults.hidden.add('generated');
    defaults.viewed.add('generated');
    options.onFilterDefaultChange?.('generated', 'hidden-viewed');
    return;
  }
  options.excluded.add(options.value);
}

function cycleViewed(
  options: FilterDefaultOptions,
  defaults: FilterDefaults,
): void {
  if (defaults.hidden.has('viewed')) {
    defaults.hidden.delete('viewed');
    options.excluded.delete(options.value);
    options.onFilterDefaultChange?.('viewed', 'shown');
    return;
  }
  if (options.excluded.has(options.value)) {
    defaults.hidden.add('viewed');
    options.onFilterDefaultChange?.('viewed', 'hidden');
    return;
  }
  options.excluded.add(options.value);
}

function isRememberedFilterFacet(
  facet: LabelFacet,
): facet is RememberedFilterFacet {
  return facet === 'viewed' || facet === 'generated';
}
