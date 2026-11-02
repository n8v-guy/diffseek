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
  const current = cycleStep(checked);
  setChanged(
    item,
    'title',
    cycleSteps
      .map((step) => `${step === current ? '●' : '○'} ${step}`)
      .join('\n'),
  );
  const name = options.facet === 'generated' ? 'Generated' : 'Viewed';
  const next = cycleSteps[(cycleSteps.indexOf(current) + 1) % cycleSteps.length];
  setChanged(item, 'aria-label', `${name}: ${current}, click for ${String(next)}`);
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

function cycleStep(checked: string): (typeof cycleSteps)[number] {
  if (checked === 'false') return hideNow;
  if (checked === 'mixed') return alwaysHide;
  return showNow;
}

function isRememberedFilterFacet(
  facet: LabelFacet,
): facet is RememberedFilterFacet {
  return facet === 'viewed' || facet === 'generated';
}

function setChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
