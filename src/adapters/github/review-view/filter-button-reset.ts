import type { FilterDefaults } from '@diffseek/browser';
import type { FilterState } from '@diffseek/review';

import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { cssAnchorName, filterMenus, filterOptionsButton } from './review-ui';

type ResetOptions = {
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  onChange: () => void;
};

const buttonResetSelector = '[data-diffseek="filter-button-reset"]';
const latestOptions = new WeakMap<HTMLButtonElement, ResetOptions>();

/** The "Reset filters" pill: its label, then the reset icon. */
export function resetFiltersButton(): HTMLButtonElement {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'diffseek-reset-filters';
  reset.dataset.resetFilters = 'true';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.dataset.diffseekResetIcon = 'true';
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 3v4h4M3.4 6.4A5 5 0 1 1 3 10');
  icon.append(path);
  const label = document.createElement('span');
  label.textContent = 'Reset filters';
  reset.append(label, icon);
  return reset;
}

/**
 * Returns whether it added or removed the pill. Shows the pill on the top-right corner of GitHub's closed filter button
 * while review-scoped exclusions hide files. It is tethered with the
 * button's own CSS anchor name, so no GitHub element is written.
 */
export function syncFilterButtonReset(root: Document, options: ResetOptions): boolean {
  const trigger = filterOptionsButton(root);
  const anchor = trigger && cssAnchorName(trigger);
  let reset = root.querySelector<HTMLButtonElement>(buttonResetSelector);
  if (
    anchor == null ||
    trigger?.getAttribute('aria-expanded') === 'true' ||
    filterMenus(root).length > 0 ||
    !hasTransientExclusions(options.filters, options.filterDefaults)
  ) {
    reset?.remove();
    return reset != null;
  }
  const wrote = reset == null;
  if (!reset) {
    const created = resetFiltersButton();
    created.dataset.diffseek = 'filter-button-reset';
    created.addEventListener('click', () => {
      const latest = latestOptions.get(created);
      if (!latest) return;
      resetTransientExclusions(latest.filters, latest.filterDefaults);
      latest.onChange();
    });
    root.body.append(created);
    reset = created;
  }
  latestOptions.set(reset, options);
  if (reset.dataset.anchor !== anchor) {
    reset.dataset.anchor = anchor;
    reset.setAttribute('style', `position-anchor: ${anchor}`);
  }
  return wrote;
}
