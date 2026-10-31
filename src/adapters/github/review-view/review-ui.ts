import type {
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import { type ViewedScope, viewedScopeNotice } from '@diffseek/review';

import {
  type ActionResult,
  clearViewedAction,
} from '../review-page/viewed-actions';

const snackbarDurationMs = 7_000;
const failureSnackbarDurationMs = 12_000;

export function menuNeedsRemount(menu: HTMLElement): boolean {
  if (menu.dataset.diffseekMenuOwned !== 'true') return true;
  if (!menu.querySelector(':scope > [data-diffseek="filters"]')) return true;
  return [...menu.children].some(
    (child) =>
      child instanceof HTMLElement &&
      child.dataset.diffseek !== 'filters' &&
      !child.hidden,
  );
}

export function filterMenus(root: Document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="menu"]')].filter(
    (menu) => {
      if (menu.getAttribute('aria-label') === 'Filter options') return true;
      const labelledBy = menu.getAttribute('aria-labelledby');
      return (
        labelledBy != null &&
        root.getElementById(labelledBy)?.textContent === 'Filter options'
      );
    },
  );
}

export function removeInjected(root: Document): void {
  for (const element of root.querySelectorAll(
    '[data-diffseek="filters"], [data-diffseek="unavailable"], [data-diffseek="snackbars"]',
  )) {
    element.remove();
  }
  for (const anchor of root.querySelectorAll(
    '[data-diffseek-viewed-action], .diffseek-viewed-icon-anchor',
  )) {
    clearViewedAction(anchor);
  }
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-diffseek-native-hidden="true"]',
  )) {
    element.hidden = false;
    delete element.dataset.diffseekNativeHidden;
  }
  for (const menu of root.querySelectorAll<HTMLElement>(
    '[data-diffseek-menu-owned]',
  )) {
    delete menu.dataset.diffseekMenuOwned;
    delete menu.dataset.diffseekNativeClearing;
  }
}

export function afterNextPaint(root: Document): Promise<void> {
  const view = root.defaultView;
  if (!view) return Promise.resolve();
  return new Promise((resolve) => {
    view.requestAnimationFrame(() => view.setTimeout(resolve, 0));
  });
}

export function showUnavailable(root: Document, reason: string): void {
  if (root.querySelector('[data-diffseek="unavailable"]')) return;
  const status = root.createElement('span');
  status.dataset.diffseek = 'unavailable';
  status.setAttribute('role', 'status');
  status.textContent = `DiffSeek unavailable: ${reason}`;
  placeStatus(root, status);
}

export function removeUnavailable(root: Document): void {
  root.querySelector('[data-diffseek="unavailable"]')?.remove();
}

export function showBatchStarted(
  root: Document,
  viewed: boolean,
  requested: number,
  scope?: ViewedScope,
): void {
  if (scope) {
    showSnackbar(root, viewedScopeNotice(scope, viewed, requested, 'progress'));
    return;
  }
  if (requested <= 1) return;
  showSnackbar(
    root,
    viewed
      ? `Marking ${fileCount(requested)} viewed…`
      : `Unmarking ${fileCount(requested)}…`,
  );
}

export function showBatchResult(
  root: Document,
  result: ActionResult,
  viewed: boolean,
  scope?: ViewedScope,
): void {
  if (result.failed.length > 0) {
    showBatchFailure(root, result, viewed);
    return;
  }
  if (scope) {
    showSnackbar(
      root,
      viewedScopeNotice(scope, viewed, result.completed.length, 'done'),
    );
    return;
  }
  const subject =
    result.completed.length === 1
      ? fileName(result.completed[0] ?? '')
      : fileCount(result.completed.length);
  showSnackbar(
    root,
    viewed ? `Marked ${subject} viewed` : `Unmarked ${subject}`,
  );
}

export function showAutoViewed(root: Document, result: ActionResult): void {
  if (result.failed.length > 0) {
    showBatchFailure(root, result, true);
    return;
  }
  if (result.completed.length === 0) return;
  showSnackbar(
    root,
    `Auto-viewed ${result.completed.length} generated ${
      result.completed.length === 1 ? 'file' : 'files'
    }`,
  );
}

function showBatchFailure(
  root: Document,
  result: ActionResult,
  viewed: boolean,
): void {
  const total = Math.max(
    result.requested,
    result.completed.length + result.failed.length,
  );
  const subject =
    total === 1 ? fileName(result.failed[0]?.path ?? '') : fileCount(total);
  let message: string;
  if (result.completed.length === 0) {
    message = viewed
      ? `Couldn't mark ${subject} viewed. Hover for details`
      : `Couldn't unmark ${subject}. Hover for details`;
  } else {
    const done = `${result.completed.length} of ${fileCount(total)}`;
    message =
      (viewed ? `Marked ${done} viewed` : `Unmarked ${done}`) +
      `; ${result.failed.length} failed. Hover for details`;
  }
  const status = showSnackbar(root, message, failureSnackbarDurationMs);
  status.title = result.failed
    .map(({ path, reason }) => `${path}: ${reason}`)
    .join('\n');
}

export function showRememberedFilterDefault(
  root: Document,
  facet: RememberedFilterFacet,
  state: FilterDefaultState,
): void {
  showSnackbar(
    root,
    `${facetName(facet)}: ${state === 'hidden' ? 'Always hide' : 'Show now'}`,
  );
}

export function showHideNow(
  root: Document,
  facet: RememberedFilterFacet,
): void {
  showSnackbar(root, `${facetName(facet)}: Hide now`);
}

export function showAlwaysRead(root: Document, enabled: boolean): void {
  showSnackbar(
    root,
    enabled
      ? 'Auto-view on: generated files get marked viewed'
      : 'Auto-view off',
  );
}

function showSnackbar(
  root: Document,
  message: string,
  durationMs = snackbarDurationMs,
): HTMLElement {
  let stack = root.querySelector<HTMLElement>(
    '[data-diffseek="snackbars"]',
  );
  if (!stack) {
    stack = root.createElement('div');
    stack.dataset.diffseek = 'snackbars';
    stack.setAttribute('aria-live', 'polite');
    root.body.append(stack);
  }
  const snackbar = root.createElement('div');
  snackbar.dataset.diffseek = 'snackbar';
  snackbar.setAttribute('role', 'status');
  snackbar.textContent = message;
  stack.append(snackbar);
  setTimeout(() => {
    snackbar.remove();
    if (stack?.childElementCount === 0) stack.remove();
  }, durationMs);
  return snackbar;
}

export function isNativeMutation(record: MutationRecord): boolean {
  const ElementType = record.target.ownerDocument?.defaultView?.Element;
  if (
    ElementType &&
    record.target instanceof ElementType &&
    record.target.closest(
      '[data-diffseek], [data-diffseek-viewed-action], .diffseek-viewed-icon-anchor',
    )
  ) {
    return false;
  }
  if (record.type === 'attributes') return true;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.some(
    (node) =>
      !ElementType ||
      !(node instanceof ElementType) ||
      !node.matches(
        '[data-diffseek], [data-diffseek-viewed-action], .diffseek-viewed-icon-anchor',
      ),
  );
}

function placeStatus(root: Document, status: HTMLElement): void {
  const trigger = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => accessibleName(button) === 'Filter options',
  );
  const anchor =
    trigger ??
    root.querySelector<HTMLElement>('[role="tree"][aria-label="File Tree"]');
  anchor?.after(status);
}

function accessibleName(element: HTMLElement): string {
  return (
    element.getAttribute('aria-label') ??
    element
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim() ??
    ''
  );
}

function fileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function facetName(facet: RememberedFilterFacet): string {
  return facet === 'generated' ? 'Generated' : 'Viewed';
}
