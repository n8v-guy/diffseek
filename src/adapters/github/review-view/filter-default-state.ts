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
  const currentStep = cycleSteps.at(current) ?? cycleSteps[0];
  const nextStep =
    cycleSteps.at((current + 1) % cycleSteps.length) ?? cycleSteps[0];
  setChanged(
    item,
    'aria-label',
    `${name}: ${currentStep}, click for ${nextStep}`,
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

const cycleSteps = ['Show now', 'Hide now', 'Always hide'] as const;

function cycleIndex(checked: string): number {
  if (checked === 'false') return 1;
  if (checked === 'mixed') return 2;
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
