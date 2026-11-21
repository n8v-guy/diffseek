import type { FilterDefaults } from '@diffseek/browser';
import type { FilterState } from '@diffseek/review';

import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { cssAnchorName, filterOptionsButton } from './review-ui';

type ResetOptions = {
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  onChange: () => void;
};

const buttonResetSelector = '[data-diffseek="filter-button-reset"]';
/** Page-level flag. CSS shows the corner Reset icon while review filters hide files. */
export const filteredAttribute = 'data-diffseek-filtered';
const latestOptions = new WeakMap<HTMLButtonElement, ResetOptions>();
const ownedPills = new WeakSet<HTMLButtonElement>();

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

/** The live, listener-owned corner pill, if any. Clones of it are discarded. */
function ownedPill(root: Document): HTMLButtonElement | null {
  const node = root.querySelector<HTMLButtonElement>(buttonResetSelector);
  if (!node) return null;
  if (ownedPills.has(node)) return node;
  node.remove();
  return null;
}

/**
 * The interactive trigger: Primer writes `anchor-name` when it hydrates the
 * button. The server-rendered copy has the same accessible name and no anchor.
 */
function anchoredTrigger(root: Document): HTMLButtonElement | null {
  const trigger = filterOptionsButton(root);
  if (!trigger || cssAnchorName(trigger) == null) return null;
  return trigger;
}

/** Keeps the icon on the trigger's corner without positioning GitHub's wrapper. */
function tether(icon: HTMLButtonElement, trigger: HTMLButtonElement): void {
  const anchor = cssAnchorName(trigger);
  if (anchor == null || icon.style.getPropertyValue('position-anchor') === anchor) return;
  icon.style.setProperty('position-anchor', anchor);
}

/**
 * Returns whether it inserted or moved the icon. Inserts the corner Reset
 * once as a sibling of GitHub's hydrated Filter options button and leaves it
 * there; re-inserts only if GitHub replaces the wrapper or the trigger. A
 * temporary gap before that hydrated trigger does not remove an owned icon,
 * and the static copy is not a place to insert one.
 */
export function ensureFilterButtonReset(root: Document, options: ResetOptions): boolean {
  const trigger = anchoredTrigger(root);
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
    tether(existing, trigger);
    const moved =
      existing.parentElement !== wrapper || trigger.nextElementSibling !== existing;
    if (moved) trigger.after(existing);
    return moved;
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
  ownedPills.add(pill);
  tether(pill, trigger);
  trigger.after(pill);
  latestOptions.set(pill, options);
  return true;
}

/** Writes the page attribute and keeps one corner Reset pill in the filter wrapper. */
export function syncFilterReset(root: Document, options: ResetOptions): boolean {
  syncFilteredAttribute(root, options.filters, options.filterDefaults);
  return ensureFilterButtonReset(root, options);
}
