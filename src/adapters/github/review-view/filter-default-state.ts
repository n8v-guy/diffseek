import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
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
  if (
    !isRememberedFilterFacet(options.facet) ||
    !options.filterDefaults
  ) {
    return false;
  }
  const defaults = options.filterDefaults;
  if (
    options.facet === 'generated' &&
    defaults.viewed.has('generated')
  ) {
    defaults.viewed.delete('generated');
    defaults.hidden.delete('generated');
    options.excluded.delete(options.value);
    options.onFilterDefaultChange?.('generated', 'shown');
  } else if (defaults.hidden.has(options.facet)) {
    if (options.facet === 'generated') {
      defaults.viewed.add('generated');
      options.onFilterDefaultChange?.('generated', 'hidden-viewed');
    } else {
      defaults.hidden.delete(options.facet);
      options.excluded.delete(options.value);
      options.onFilterDefaultChange?.(options.facet, 'shown');
    }
  } else if (options.excluded.has(options.value)) {
    defaults.hidden.add(options.facet);
    options.onFilterDefaultChange?.(options.facet, 'hidden');
  } else {
    options.excluded.add(options.value);
  }
  return true;
}

function isRememberedFilterFacet(
  facet: LabelFacet,
): facet is RememberedFilterFacet {
  return facet === 'viewed' || facet === 'generated';
}
