import type {
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';

import {
  type ActionResult,
  clearViewedAction,
} from '../review-page/viewed-actions';

const snackbarDurationMs = 7_000;

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
): void {
  showSnackbar(
    root,
    `Marking ${fileCount(requested)} as ${stateLabel(viewed)}…`,
  );
}

export function showBatchResult(
  root: Document,
  result: ActionResult,
  viewed: boolean,
): void {
  const status = showSnackbar(
    root,
    `Marked ${fileCount(result.completed.length)} as ${stateLabel(viewed)}` +
      (result.failed.length > 0 ? `; ${result.failed.length} failed` : ''),
  );
  if (result.failed.length > 0) {
    status.title = result.failed
      .map(({ path, reason }) => `${path}: ${reason}`)
      .join('\n');
  }
}

export function showRememberedFilterDefault(
  root: Document,
  facet: RememberedFilterFacet,
  state: FilterDefaultState,
): void {
  const label = facet === 'viewed' ? 'viewed files' : 'generated files';
  const message =
    state === 'hidden-viewed'
      ? 'Hide and mark viewed generated files by default'
      : state === 'hidden'
        ? `Hide ${label} by default`
        : `Show ${label} by default`;
  showSnackbar(root, message);
}

function showSnackbar(root: Document, message: string): HTMLElement {
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
  }, snackbarDurationMs);
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

function stateLabel(viewed: boolean): string {
  return viewed ? 'viewed' : 'not viewed';
}
