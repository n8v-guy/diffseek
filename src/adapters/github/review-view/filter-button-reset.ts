import type { FilterDefaults } from '@diffseek/browser';
import type { FilterState } from '@diffseek/review';

import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { anchoredFilterTrigger, isFilterOptionsTrigger } from './review-ui';

type ResetOptions = {
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  onChange: () => void;
};

const buttonResetSelector = '[data-diffseek="filter-button-reset"]';
/** Set on the trigger Reset was mounted beside. CSS shows the icon only next to it. */
export const filterTriggerMark = 'data-diffseek-filter-trigger';
/** Page-level flag. CSS shows the corner Reset icon while review filters hide files. */
const filteredAttribute = 'data-diffseek-filtered';
const latestOptions = new WeakMap<HTMLButtonElement, ResetOptions>();
const retainedTrigger = new WeakMap<Document, HTMLButtonElement>();
const ownedIcon = new WeakMap<Document, HTMLButtonElement>();

function resetIcon(): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.dataset.diffseekResetIcon = 'true';
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 3v4h4M3.4 6.4A5 5 0 1 1 3 10');
  icon.append(path);
  return icon;
}

/** Menu row: label, then the reset icon. */
export function resetFiltersButton(): HTMLButtonElement {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'diffseek-reset-filters';
  reset.dataset.resetFilters = 'true';
  const label = document.createElement('span');
  label.textContent = 'Reset filters';
  reset.append(label, resetIcon());
  return reset;
}

/**
 * Writes `data-diffseek-filtered` on `<html>` only when the review-scoped
 * exclusion state changes. Visibility of the corner icon is CSS-only.
 */
function syncFilteredAttribute(
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

/**
 * Anchor-name is only how the first trigger is found. The same node stays
 * the trigger while it is connected and still named Filter options.
 * Read-only: the observer must not drop the retained node before cleanup.
 */
function readTrigger(root: Document): HTMLButtonElement | null {
  const remembered = retainedTrigger.get(root);
  if (remembered?.isConnected && isFilterOptionsTrigger(remembered)) {
    return remembered;
  }
  return anchoredFilterTrigger(root);
}

function owned(root: Document): HTMLButtonElement | null {
  const icon = ownedIcon.get(root);
  if (icon?.isConnected) return icon;
  if (icon) ownedIcon.delete(root);
  return null;
}

/** Drops cloned icons. The owned node is the one this document inserted. */
function discardCopies(root: Document): boolean {
  const keep = owned(root);
  let wrote = false;
  for (const copy of root.querySelectorAll<HTMLButtonElement>(buttonResetSelector)) {
    if (copy === keep) continue;
    copy.remove();
    wrote = true;
  }
  return wrote;
}

/** The icon was added or removed. A sibling between it and the trigger is not a repair. */
export function filterResetNeedsRepair(record: MutationRecord): boolean {
  if (record.type !== 'childList') return false;
  for (const node of [...record.removedNodes, ...record.addedNodes]) {
    if (node instanceof Element && node.matches(buttonResetSelector)) return true;
  }
  return false;
}

function cornerButton(): HTMLButtonElement {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.dataset.resetFilters = 'true';
  reset.dataset.diffseek = 'filter-button-reset';
  reset.setAttribute('aria-label', 'Reset filters');
  reset.append(resetIcon());
  reset.addEventListener('click', (event) => {
    event.stopPropagation();
    const latest = latestOptions.get(reset);
    if (!latest) return;
    resetTransientExclusions(latest.filters, latest.filterDefaults);
    latest.onChange();
  });
  return reset;
}

function place(icon: HTMLButtonElement, trigger: HTMLButtonElement): void {
  if (!trigger.hasAttribute(filterTriggerMark)) trigger.setAttribute(filterTriggerMark, '');
  trigger.after(icon);
}

/** A renamed trigger must not keep showing Reset. */
function clearTriggerMark(button: HTMLButtonElement | undefined): boolean {
  if (!button?.isConnected || !button.hasAttribute(filterTriggerMark)) return false;
  button.removeAttribute(filterTriggerMark);
  return true;
}

/**
 * Returns whether a review reconcile should count. Mounting, and leaving the
 * icon where it is when a sibling appears, do not. A move to a new wrapper,
 * a dropped clone, or a marker change does.
 */
function ensureFilterButtonReset(root: Document, options: ResetOptions): boolean {
  const previous = retainedTrigger.get(root);
  const trigger = readTrigger(root);
  if (trigger) retainedTrigger.set(root, trigger);
  else retainedTrigger.delete(root);
  const icon = owned(root);
  const released = previous?.isSameNode(trigger) ? undefined : previous;
  let wrote = discardCopies(root);
  if (clearTriggerMark(released)) wrote = true;
  if (!trigger?.parentElement) {
    if (icon) latestOptions.set(icon, options);
    return wrote;
  }
  if (icon?.parentElement?.isSameNode(trigger.parentElement)) {
    latestOptions.set(icon, options);
    if (!trigger.hasAttribute(filterTriggerMark)) {
      trigger.setAttribute(filterTriggerMark, '');
      wrote = true;
    }
    return wrote;
  }
  if (icon) {
    latestOptions.set(icon, options);
    place(icon, trigger);
    return true;
  }
  const created = cornerButton();
  latestOptions.set(created, options);
  ownedIcon.set(root, created);
  place(created, trigger);
  return wrote;
}

/** Writes the page attribute and keeps one corner Reset icon beside the live trigger. */
export function syncFilterReset(root: Document, options: ResetOptions): boolean {
  syncFilteredAttribute(root, options.filters, options.filterDefaults);
  return ensureFilterButtonReset(root, options);
}
