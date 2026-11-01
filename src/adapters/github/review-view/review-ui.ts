import type { FilterDefaultState } from '@diffseek/browser/filter-defaults';

import {
  type ActionResult,
  clearViewedAction,
  type ViewedTarget,
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
  status.textContent = `DiffSeek unavailable. ${reason}`;
  placeStatus(root, status);
}

export function removeUnavailable(root: Document): void {
  root.querySelector('[data-diffseek="unavailable"]')?.remove();
}

/** A single file has no progress message; its checkbox answers at once. */
type BatchMessages = { progress?: string; done: string; failed: string };

const markMessages: Record<ViewedTarget, BatchMessages> = {
  file: {
    done: 'File marked viewed',
    failed: "Couldn't mark file viewed. Try again.",
  },
  folder: {
    progress: 'Marking visible files in folder viewed…',
    done: 'Visible files in folder marked viewed',
    failed: "Couldn't mark files viewed. Try again.",
  },
  category: {
    progress: 'Marking all files in category viewed…',
    done: 'All files in category marked viewed',
    failed: "Couldn't mark files viewed. Try again.",
  },
  'auto-view': {
    progress: 'Auto-view: marking generated files viewed…',
    done: 'Auto-view: generated files marked viewed',
    failed: "Couldn't mark files viewed. Try again.",
  },
};

const unmarkMessages: Record<ViewedTarget, BatchMessages> = {
  file: {
    done: 'File unmarked',
    failed: "Couldn't unmark file. Try again.",
  },
  folder: {
    progress: 'Unmarking visible files in folder…',
    done: 'Visible files in folder unmarked',
    failed: "Couldn't unmark files. Try again.",
  },
  category: {
    progress: 'Unmarking all files in category…',
    done: 'All files in category unmarked',
    failed: "Couldn't unmark files. Try again.",
  },
  'auto-view': markMessages['auto-view'],
};

function batchMessages(target: ViewedTarget, viewed: boolean): BatchMessages {
  return (viewed ? markMessages : unmarkMessages)[target];
}

export function showBatchStarted(
  root: Document,
  target: ViewedTarget,
  viewed: boolean,
): void {
  const { progress } = batchMessages(target, viewed);
  if (progress) showSnackbar(root, progress);
}

export function showBatchResult(
  root: Document,
  target: ViewedTarget,
  viewed: boolean,
  result: ActionResult,
): void {
  const messages = batchMessages(target, viewed);
  showSnackbar(root, result.failed.length > 0 ? messages.failed : messages.done);
}

export function showRememberedFilterDefault(
  root: Document,
  state: FilterDefaultState,
): void {
  showSnackbar(
    root,
    state === 'hidden' ? 'Always hidden' : 'Shown',
  );
}

export function showHideNow(root: Document): void {
  showSnackbar(root, 'Hidden');
}

export function showAlwaysRead(root: Document, enabled: boolean): void {
  showSnackbar(
    root,
    enabled
      ? 'Auto-view on: generated files get marked viewed'
      : 'Auto-view off',
  );
}

function showSnackbar(root: Document, message: string): void {
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
