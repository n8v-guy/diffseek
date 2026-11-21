import type { FilterDefaults } from '@diffseek/browser';
import type { FilterState } from '@diffseek/review';

import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { filterOptionsButton } from './review-ui';

type ResetOptions = {
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  onChange: () => void;
};

const buttonResetSelector = '[data-diffseek="filter-button-reset"]';
/** Page-level flag. CSS shows the corner Reset pill while review filters hide files. */
export const filteredAttribute = 'data-diffseek-filtered';
const latestOptions = new WeakMap<HTMLButtonElement, ResetOptions>();
const ownedPills = new WeakSet<HTMLButtonElement>();

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
 * Writes `data-diffseek-filtered` on `<html>` only when the review-scoped
 * exclusion state changes. Visibility of the corner pill is CSS-only.
 */
export function syncFilteredAttribute(
  root: Document,
  filters: FilterState,
  filterDefaults?: FilterDefaults,
): void {
  const on = hasTransientExclusions(filters, filterDefaults);
  const el = root.documentElement;
  if (on) {
    if (el.getAttribute(filteredAttribute) !== 'true') {
      el.setAttribute(filteredAttribute, 'true');
    }
    return;
  }
  if (el.hasAttribute(filteredAttribute)) el.removeAttribute(filteredAttribute);
}

/** The live, listener-owned corner pill, if any. Clones of it are discarded. */
function ownedPill(root: Document): HTMLButtonElement | null {
  const node = root.querySelector<HTMLButtonElement>(buttonResetSelector);
  if (!node) return null;
  if (ownedPills.has(node)) return node;
  node.remove();
  return null;
}

/**
 * Returns whether it inserted or moved the pill. Inserts the corner Reset
 * once as a sibling of GitHub's Filter options button and leaves it there;
 * re-inserts only if GitHub replaces the wrapper or the trigger. A temporary
 * gap between the static trigger and the hydrated one does not remove it.
 */
export function ensureFilterButtonReset(root: Document, options: ResetOptions): boolean {
  const trigger = filterOptionsButton(root);
  const wrapper = trigger?.parentElement;
  const existing = ownedPill(root);
  if (!trigger || !wrapper) {
    if (existing?.isConnected) {
      latestOptions.set(existing, options);
      return false;
    }
    const wrote = existing != null;
    existing?.remove();
    return wrote;
  }
  if (existing) {
    latestOptions.set(existing, options);
    const moved =
      existing.parentElement !== wrapper || trigger.nextElementSibling !== existing;
    if (moved) trigger.after(existing);
    return moved;
  }
  const pill = resetFiltersButton();
  pill.dataset.diffseek = 'filter-button-reset';
  pill.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const latest = latestOptions.get(pill);
      if (!latest) return;
      resetTransientExclusions(latest.filters, latest.filterDefaults);
      latest.onChange();
    },
    true,
  );
  ownedPills.add(pill);
  trigger.after(pill);
  latestOptions.set(pill, options);
  return true;
}

/** Writes the page attribute and keeps one corner Reset pill in the filter wrapper. */
export function syncFilterReset(root: Document, options: ResetOptions): boolean {
  syncFilteredAttribute(root, options.filters, options.filterDefaults);
  return ensureFilterButtonReset(root, options);
}
