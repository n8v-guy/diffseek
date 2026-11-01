import type { FilterDefaultState } from '@diffseek/browser/filter-defaults';

import {
  type ActionResult,
  clearViewedAction,
  type ViewedTarget,
} from '../review-page/viewed-actions';

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

/** Resolves in the first task after the next frame, i.e. once it painted. */
export function afterNextPaint(root: Document): Promise<void> {
  const view = root.defaultView;
  if (!view) return Promise.resolve();
  return new Promise((resolve) => {
    view.requestAnimationFrame(() => afterCurrentTask(resolve));
  });
}

/**
 * Runs `run` as the next task (a MessageChannel message, not a 0 ms timer).
 * Returns a cancel function.
 */
export function afterCurrentTask(run: () => void): () => void {
  const channel = new MessageChannel();
  let live = true;
  channel.port1.onmessage = () => {
    channel.port1.close();
    if (live) run();
  };
  channel.port2.postMessage(null);
  return () => {
    live = false;
    channel.port1.close();
  };
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

/** Returns the progress toast so its batch's outcome can replace it. */
export function showBatchStarted(
  root: Document,
  target: ViewedTarget,
  viewed: boolean,
): HTMLElement | null {
  const { progress } = batchMessages(target, viewed);
  return progress ? showSnackbar(root, progress, 'progress') : null;
}

export function showBatchResult(
  root: Document,
  target: ViewedTarget,
  viewed: boolean,
  result: ActionResult,
  progress: HTMLElement | null = null,
): void {
  const messages = batchMessages(target, viewed);
  const message = result.failed.length > 0 ? messages.failed : messages.done;
  if (progress?.isConnected) {
    // Replace in place so the live region announces the outcome.
    dismissStatusSnackbars(root, false);
    progress.dataset.diffseekSnackbarKind = 'status';
    progress.textContent = message;
    progress.parentElement?.append(progress);
    return;
  }
  showSnackbar(root, message);
}

/** A batch that was cancelled has no outcome; drop its progress toast. */
export function dismissSnackbar(snackbar: HTMLElement | null): void {
  if (!snackbar) return;
  const stack = snackbar.parentElement;
  snackbar.remove();
  if (stack?.childElementCount === 0) stack.remove();
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

/**
 * Toasts have no timer. A progress toast lasts until its batch finishes. Any
 * other toast lasts until the reviewer next presses a pointer or key or scrolls
 * with the wheel, or until a newer toast replaces it. Pressing a toast closes
 * it, a progress toast too.
 */
function showSnackbar(
  root: Document,
  message: string,
  kind: 'progress' | 'status' = 'status',
): HTMLElement {
  dismissStatusSnackbars(root, false);
  listenForDismissal(root);
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
  snackbar.dataset.diffseekSnackbarKind = kind;
  snackbar.setAttribute('role', 'status');
  snackbar.textContent = message;
  stack.append(snackbar);
  return snackbar;
}

const dismissingDocuments = new WeakSet<Document>();

function listenForDismissal(root: Document): void {
  if (dismissingDocuments.has(root)) return;
  dismissingDocuments.add(root);
  // Capture phase: runs before the click that may show the next toast.
  const dismiss = () => dismissStatusSnackbars(root, true);
  root.addEventListener(
    'pointerdown',
    (event) => {
      // Pressing a toast closes it, progress included; anywhere else closes
      // only finished toasts.
      const target = event.target;
      const toast =
        target instanceof Element
          ? target.closest<HTMLElement>('[data-diffseek="snackbar"]')
          : null;
      dismissSnackbar(toast);
      dismiss();
    },
    true,
  );
  root.addEventListener('keydown', dismiss, true);
  root.addEventListener('wheel', dismiss, { capture: true, passive: true });
}

function dismissStatusSnackbars(root: Document, removeEmptyStack: boolean): void {
  for (const snackbar of root.querySelectorAll<HTMLElement>(
    '[data-diffseek="snackbar"][data-diffseek-snackbar-kind="status"]',
  )) {
    if (removeEmptyStack) dismissSnackbar(snackbar);
    else snackbar.remove();
  }
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
