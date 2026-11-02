import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import type { LabelFacet } from '@diffseek/review';

export interface FilterDefaultOptions {
  excluded: Set<string>;
  facet: LabelFacet;
  filterDefaults?: FilterDefaults;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
  value: string;
}

const alwaysHide = 'Always hide';
const hideNow = 'Hide now';
const showNow = 'Show now';
const cycleSteps = [showNow, hideNow, alwaysHide] as const;
const alwaysHideIndex = cycleSteps.indexOf(alwaysHide);
const hideNowIndex = cycleSteps.indexOf(hideNow);

export function applyCheckedState(
  item: HTMLButtonElement,
  options: FilterDefaultOptions,
): void {
  const remembered =
    isRememberedFilterFacet(options.facet) &&
    (options.filterDefaults?.hidden.has(options.facet) ?? false);
  const checked = remembered
    ? 'mixed'
    : String(!options.excluded.has(options.value));
  setChanged(item, 'aria-checked', checked);
  if (!isRememberedFilterFacet(options.facet)) return;
  const current = cycleIndex(checked);
  setChanged(
    item,
    'title',
    cycleSteps
      .map((step, index) => `${index === current ? '●' : '○'} ${step}`)
      .join('\n'),
  );
  const name = options.facet === 'generated' ? 'Generated' : 'Viewed';
  const next = cycleSteps[(current + 1) % cycleSteps.length];
  setChanged(item, 'aria-label', `${name}: ${cycleSteps[current]}, click for ${next}`);
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

function cycleIndex(checked: string): number {
  if (checked === 'false') return hideNowIndex;
  if (checked === 'mixed') return alwaysHideIndex;
  return 0;
}

function isRememberedFilterFacet(
  facet: LabelFacet,
): facet is RememberedFilterFacet {
  return facet === 'viewed' || facet === 'generated';
}

function setChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
