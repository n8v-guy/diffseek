import type { FilterDefaults } from '@diffseek/browser';
import type { FilterState } from '@diffseek/review';

import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { anchoredFilterTrigger, cssAnchorName, isFilterOptionsTrigger } from './review-ui';

type ResetOptions = {
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  onChange: () => void;
};

const resetFiltersLabel = 'Reset filters';
const buttonResetSelector = '[data-diffseek="filter-button-reset"]';
/** Set on the trigger Reset was mounted beside. CSS shows the icon only next to it. */
export const filterTriggerMark = 'data-diffseek-filter-trigger';
/** Page-level flag. CSS shows the Reset icon beside the closed filter button. */
const filteredAttribute = 'data-diffseek-filtered';
const latestOptions = new WeakMap<HTMLButtonElement, ResetOptions>();
const retainedTrigger = new WeakMap<Document, HTMLButtonElement>();
/** Kept after a rename so the name can be restored without another mutation. */
const watchedTrigger = new WeakMap<Document, HTMLButtonElement>();
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

/** Menu badge: label, then the reset icon. */
export function resetFiltersButton(): HTMLButtonElement {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'diffseek-reset-filters';
  reset.dataset.resetFilters = 'true';
  reset.setAttribute('aria-label', resetFiltersLabel);
  const label = document.createElement('span');
  label.textContent = resetFiltersLabel;
  reset.append(label, resetIcon());
  return reset;
}

/**
 * Writes `data-diffseek-filtered` on `<html>` only when the review-scoped
 * exclusion state changes. Visibility of the icon is CSS-only.
 */
function syncFilteredAttribute(
  root: Document,
  filters: FilterState,
  filterDefaults?: FilterDefaults,
): boolean {
  const on = hasTransientExclusions(filters, filterDefaults);
  const el = root.documentElement;
  if (on) {
    if (el.getAttribute(filteredAttribute) === 'true') return false;
    el.setAttribute(filteredAttribute, 'true');
    return true;
  }
  if (!el.hasAttribute(filteredAttribute)) return false;
  el.removeAttribute(filteredAttribute);
  return true;
}

/**
 * Anchor-name is only how the first trigger is found. The same node stays
 * the trigger while it is connected and still named Filter options.
 * Read-only: the observer must not drop the retained node before cleanup.
 */
function readTrigger(root: Document): HTMLButtonElement | null {
  const watched = watchedFilterTrigger(root);
  if (watched && isFilterOptionsTrigger(watched)) return watched;
  const remembered = retainedTrigger.get(root);
  if (remembered?.isConnected && isFilterOptionsTrigger(remembered)) return remembered;
  return anchoredFilterTrigger(root);
}

function remember(root: Document, trigger: HTMLButtonElement | null, verified: boolean): void {
  if (trigger) {
    retainedTrigger.set(root, trigger);
    if (verified) watchedTrigger.set(root, trigger);
    return;
  }
  retainedTrigger.delete(root);
  const watched = watchedTrigger.get(root);
  if (watched && !watched.isConnected) watchedTrigger.delete(root);
}

/** The last verified trigger, including while a rename has cleared its name. */
export function watchedFilterTrigger(root: Document): HTMLButtonElement | null {
  const button = watchedTrigger.get(root);
  if (button?.isConnected) return button;
  if (button) watchedTrigger.delete(root);
  return null;
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

/** The icon was added or removed. A sibling between it and the trigger is left alone. */
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
  reset.setAttribute('aria-label', resetFiltersLabel);
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
  const anchor = cssAnchorName(trigger);
  if (anchor) icon.style.setProperty('position-anchor', anchor);
  trigger.after(icon);
}

/** A renamed trigger must not keep showing Reset. */
function clearTriggerMark(button: HTMLButtonElement | undefined): boolean {
  if (!button?.isConnected || !button.hasAttribute(filterTriggerMark)) return false;
  button.removeAttribute(filterTriggerMark);
  return true;
}

type BadgeWrite = { wrote: boolean; placed: boolean };

/**
 * `due` is a session restore or a menu close. Only then is a missing icon
 * inserted. An icon already in the wrapper only has its mark kept current.
 */
function ensureFilterButtonReset(
  root: Document,
  options: ResetOptions,
  due: boolean,
): BadgeWrite {
  const previous = retainedTrigger.get(root);
  const trigger = readTrigger(root);
  let icon = owned(root);
  const released = previous?.isSameNode(trigger) ? undefined : previous;
  let wrote = discardCopies(root);
  if (clearTriggerMark(released)) wrote = true;
  const placed = Boolean(
    trigger?.parentElement && icon?.parentElement?.isSameNode(trigger.parentElement),
  );
  remember(root, trigger, placed);
  if (!trigger?.parentElement) {
    if (icon) latestOptions.set(icon, options);
    return { wrote, placed: false };
  }
  if (placed && icon) {
    latestOptions.set(icon, options);
    if (!trigger.hasAttribute(filterTriggerMark)) {
      trigger.setAttribute(filterTriggerMark, '');
      wrote = true;
    }
    return { wrote, placed: true };
  }
  if (!due) return { wrote, placed: false };
  if (icon) latestOptions.set(icon, options);
  else {
    const created = cornerButton();
    latestOptions.set(created, options);
    ownedIcon.set(root, created);
    icon = created;
  }
  place(icon, trigger);
  remember(root, trigger, true);
  return { wrote: true, placed: true };
}

/** Writes the page attribute. Inserts the icon only when `due`. */
export function syncFilterReset(
  root: Document,
  options: ResetOptions,
  due = false,
): BadgeWrite {
  const attribute = syncFilteredAttribute(root, options.filters, options.filterDefaults);
  const badge = ensureFilterButtonReset(root, options, due);
  return { wrote: attribute || badge.wrote, placed: badge.placed };
}
