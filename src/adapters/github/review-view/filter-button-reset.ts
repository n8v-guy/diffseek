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
/** Page-level flag. CSS shows the corner Reset icon while review filters hide files. */
export const filteredAttribute = 'data-diffseek-filtered';
const latestOptions = new WeakMap<HTMLButtonElement, ResetOptions>();

/** Menu row: label, then the reset icon. The corner control drops the label. */
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
 * exclusion state changes. Visibility of the corner icon is CSS-only.
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

/** The listener-owned corner icon. A clone is not in the map and is discarded. */
function ownedPill(root: Document): HTMLButtonElement | null {
  const node = root.querySelector<HTMLButtonElement>(buttonResetSelector);
  if (!node) return null;
  if (latestOptions.has(node)) return node;
  node.remove();
  return null;
}

/**
 * Returns whether it changed the DOM. The icon is inserted once beside the
 * current Filter options button and is not written again until GitHub moves
 * that button or breaks the adjacency. Positioning is CSS, so an anchor-name
 * change on the same trigger writes nothing.
 */
export function ensureFilterButtonReset(root: Document, options: ResetOptions): boolean {
  const trigger = filterOptionsButton(root);
  const wrapper = trigger?.parentElement ?? null;
  const existing = ownedPill(root);
  if (!trigger || !wrapper) {
    if (existing) latestOptions.set(existing, options);
    return false;
  }
  if (existing) {
    latestOptions.set(existing, options);
    if (existing.parentElement === wrapper && trigger.nextElementSibling === existing) {
      return false;
    }
    trigger.after(existing);
    return true;
  }
  const pill = resetFiltersButton();
  pill.querySelector('span')?.remove();
  pill.setAttribute('aria-label', 'Reset filters');
  pill.dataset.diffseek = 'filter-button-reset';
  pill.addEventListener('click', (event) => {
    event.stopPropagation();
    const latest = latestOptions.get(pill);
    if (!latest) return;
    resetTransientExclusions(latest.filters, latest.filterDefaults);
    latest.onChange();
  });
  latestOptions.set(pill, options);
  trigger.after(pill);
  return true;
}

/** Writes the page attribute and keeps one corner Reset pill in the filter wrapper. */
export function syncFilterReset(root: Document, options: ResetOptions): boolean {
  syncFilteredAttribute(root, options.filters, options.filterDefaults);
  return ensureFilterButtonReset(root, options);
}
