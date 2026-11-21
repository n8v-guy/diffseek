import type { FilterDefaults } from '@diffseek/browser';
import type { FilterState } from '@diffseek/review';

import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { anchoredFilterTrigger, cssAnchorName, isFilterOptionsTrigger } from './review-ui';

type ResetOptions = {
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  onChange: () => void;
};

const buttonResetSelector = '[data-diffseek="filter-button-reset"]';
const triggerMark = 'data-diffseek-filter-trigger';
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
 * The live trigger, once it has Primer's anchor name. The same node stays
 * the trigger while it is connected and still named, so a later anchor
 * rewrite does not move the icon.
 */
function liveTrigger(root: Document): HTMLButtonElement | null {
  const remembered = retainedTrigger.get(root);
  if (
    remembered?.isConnected &&
    isFilterOptionsTrigger(remembered) &&
    cssAnchorName(remembered) != null
  ) {
    return remembered;
  }
  const next = anchoredFilterTrigger(root);
  if (next) retainedTrigger.set(root, next);
  return next;
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

/** Child-list edits in the owned wrapper that separate Reset from its trigger. */
export function filterResetNeedsRepair(record: MutationRecord): boolean {
  if (record.type !== 'childList') return false;
  const root = record.target.ownerDocument;
  if (!root) return false;
  const icon = owned(root);
  for (const node of [...record.removedNodes, ...record.addedNodes]) {
    if (node instanceof Element && node.matches(buttonResetSelector)) return true;
  }
  if (!icon?.parentNode?.isSameNode(record.target)) return false;
  const trigger = liveTrigger(root);
  return trigger != null && !trigger.nextElementSibling?.isSameNode(icon);
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
  if (!trigger.hasAttribute(triggerMark)) trigger.setAttribute(triggerMark, '');
  trigger.after(icon);
}

/**
 * Returns whether it changed the DOM. The icon mounts once, beside the
 * anchor-named trigger, and is not written again while that trigger stays
 * connected, named, and adjacent.
 */
function ensureFilterButtonReset(root: Document, options: ResetOptions): boolean {
  const trigger = liveTrigger(root);
  const icon = owned(root);
  const removedCopies = discardCopies(root);
  if (!trigger?.parentElement) {
    if (icon) latestOptions.set(icon, options);
    return removedCopies;
  }
  if (icon) {
    latestOptions.set(icon, options);
    if (
      icon.parentElement?.isSameNode(trigger.parentElement) &&
      trigger.nextElementSibling?.isSameNode(icon)
    ) {
      return removedCopies;
    }
    place(icon, trigger);
    return true;
  }
  const created = cornerButton();
  latestOptions.set(created, options);
  ownedIcon.set(root, created);
  place(created, trigger);
  return true;
}

/** Writes the page attribute and keeps one corner Reset icon beside the live trigger. */
export function syncFilterReset(root: Document, options: ResetOptions): boolean {
  syncFilteredAttribute(root, options.filters, options.filterDefaults);
  return ensureFilterButtonReset(root, options);
}
