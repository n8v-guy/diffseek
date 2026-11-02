import type { FilterDefaultState } from '@diffseek/browser/filter-defaults';

import {
  type ActionResult,
  clearViewedAction,
  type ViewedTarget,
} from '../review-page/viewed-actions';

/** The one product timer that paces UI: the shortest time a toast stays up. */
const snackbarMinimumMs = 5_000;

const ariaLabel = 'aria-label';
const ariaLabelledBy = 'aria-labelledby';
const couldNotMark = "Couldn't mark files viewed. Try again.";
const couldNotUnmark = "Couldn't unmark files. Try again.";
const filterOptions = 'Filter options';
const injectedSelector =
  '[data-diffseek], [data-diffseek-viewed-action], .diffseek-viewed-icon-anchor';
const snackbarSelector = '[data-diffseek="snackbar"]';
const unavailableSelector = '[data-diffseek="unavailable"]';

/** A single file has no progress message; its checkbox answers at once. */
interface BatchMessages {
  done: string;
  failed: string;
  progress?: string;
}

/**
 * Runs `run` as the next task (a MessageChannel message, not a 0 ms timer).
 * Returns a cancel function.
 */
export function afterCurrentTask(run: () => void): () => void {
  const channel = new MessageChannel();
  let live = true;
  channel.port1.addEventListener('message', (): void => {
    channel.port1.close();
    if (live) run();
  });
  // addEventListener does not start the port; onmessage would.
  channel.port1.start();
  channel.port2.postMessage(null);
  return () => {
    live = false;
    channel.port1.close();
  };
}

/** Resolves in the first task after the next frame, i.e. once it painted. */
export function afterNextPaint(root: Document): Promise<void> {
  const view = root.defaultView;
  if (!view) return Promise.resolve();
  return new Promise((resolve) => {
    view.requestAnimationFrame(() => {
      afterCurrentTask(resolve);
    });
  });
}

export function filterMenus(root: Document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="menu"]')].filter(
    (menu) => menuMatchesFilter(root, menu),
  );
}

export function menuNeedsRemount(menu: HTMLElement): boolean {
  if (
    menu.dataset['diffseekMenuOwned'] !== 'true' ||
    !menu.querySelector(':scope > [data-diffseek="filters"]')
  ) {
    return true;
  }
  return [...menu.children].some(
    (child) =>
      child instanceof HTMLElement &&
      child.dataset['diffseek'] !== 'filters' &&
      child.hidden === false,
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
    delete element.dataset['diffseekNativeHidden'];
  }
  for (const menu of root.querySelectorAll<HTMLElement>(
    '[data-diffseek-menu-owned]',
  )) {
    delete menu.dataset['diffseekMenuOwned'];
    delete menu.dataset['diffseekNativeClearing'];
  }
}

export function removeUnavailable(root: Document): void {
  root.querySelector(unavailableSelector)?.remove();
}

export function showUnavailable(root: Document, reason: string): void {
  if (root.querySelector(unavailableSelector)) return;
  const status = root.createElement('span');
  status.dataset['diffseek'] = 'unavailable';
  status.setAttribute('role', 'status');
  status.textContent = `DiffSeek unavailable. ${reason}`;
  placeStatus(root, status);
}

const markMessages: Record<ViewedTarget, BatchMessages> = {
  'auto-view': {
    done: 'Auto-view: generated files marked viewed',
    failed: couldNotMark,
    progress: 'Auto-view: marking generated files viewed…',
  },
  category: {
    done: 'All files in category marked viewed',
    failed: couldNotMark,
    progress: 'Marking all files in category viewed…',
  },
  file: {
    done: 'File marked viewed',
    failed: "Couldn't mark file viewed. Try again.",
  },
  folder: {
    done: 'Visible files in folder marked viewed',
    failed: couldNotMark,
    progress: 'Marking visible files in folder viewed…',
  },
};

const unmarkMessages: Record<ViewedTarget, BatchMessages> = {
  'auto-view': markMessages['auto-view'],
  category: {
    done: 'All files in category unmarked',
    failed: couldNotUnmark,
    progress: 'Unmarking all files in category…',
  },
  file: {
    done: 'File unmarked',
    failed: "Couldn't unmark file. Try again.",
  },
  folder: {
    done: 'Visible files in folder unmarked',
    failed: couldNotUnmark,
    progress: 'Unmarking visible files in folder…',
  },
};

/** A batch that was cancelled has no outcome; drop its progress toast. */
export function dismissSnackbar(snackbar: HTMLElement | null): void {
  if (!snackbar) return;
  const stack = snackbar.parentElement;
  snackbar.remove();
  if (stack?.childElementCount === 0) stack.remove();
}

export function showAlwaysRead(root: Document, enabled: boolean): void {
  showSnackbar(
    root,
    enabled
      ? 'Auto-view on: generated files get marked viewed'
      : 'Auto-view off',
  );
}

export function showBatchResult(
  ...[root, target, viewed, result, progress = null]: [
    root: Document,
    target: ViewedTarget,
    viewed: boolean,
    result: ActionResult,
    progress?: HTMLElement | null,
  ]
): void {
  const messages = batchMessages(target, viewed);
  const message = result.failed.length > 0 ? messages.failed : messages.done;
  if (progress?.isConnected === true) {
    // Replace in place so the live region announces the outcome.
    replaceStatusSnackbars(root);
    progress.textContent = message;
    settleAfterMinimum(progress);
    progress.parentElement?.append(progress);
    return;
  }
  showSnackbar(root, message);
}

/** Returns the progress toast so its batch's outcome can replace it. */
export function showBatchStarted(
  root: Document,
  target: ViewedTarget,
  viewed: boolean,
): HTMLElement | null {
  const { progress } = batchMessages(target, viewed);
  if (progress === undefined || progress === '') return null;
  return showSnackbar(root, progress, 'progress');
}

export function showHideNow(root: Document): void {
  showSnackbar(root, 'Hidden');
}

export function showRememberedFilterDefault(
  root: Document,
  state: FilterDefaultState,
): void {
  showSnackbar(root, state === 'hidden' ? 'Always hidden' : 'Shown');
}

function batchMessages(target: ViewedTarget, viewed: boolean): BatchMessages {
  return (viewed ? markMessages : unmarkMessages)[target];
}

function settleAfterMinimum(snackbar: HTMLElement): void {
  snackbar.dataset['diffseekSnackbarKind'] = 'status';
  delete snackbar.dataset['diffseekSnackbarSettled'];
  const view = snackbar.ownerDocument.defaultView;
  view?.setTimeout(() => {
    if (snackbar.isConnected) snackbar.dataset['diffseekSnackbarSettled'] = 'true';
  }, snackbarMinimumMs);
}

/**
 * A progress toast lasts until its batch finishes and then turns into the
 * outcome in place. Any other toast stays up for a minimum time; after that,
 * the reviewer's next click on the page, key press, or wheel scroll hides it.
 * Input before the minimum does not count and is not queued. A newer toast
 * replaces it at any time, and clicking a toast closes it at once.
 */
function showSnackbar(
  root: Document,
  message: string,
  kind: 'progress' | 'status' = 'status',
): HTMLElement {
  replaceStatusSnackbars(root);
  listenForDismissal(root);
  let stack = root.querySelector<HTMLElement>('[data-diffseek="snackbars"]');
  if (!stack) {
    stack = root.createElement('div');
    stack.dataset['diffseek'] = 'snackbars';
    stack.setAttribute('aria-live', 'polite');
    root.body.append(stack);
  }
  const snackbar = root.createElement('div');
  snackbar.dataset['diffseek'] = 'snackbar';
  snackbar.dataset['diffseekSnackbarKind'] = kind;
  snackbar.setAttribute('role', 'status');
  snackbar.textContent = message;
  stack.append(snackbar);
  if (kind === 'status') settleAfterMinimum(snackbar);
  return snackbar;
}

const dismissingDocuments = new WeakSet<Document>();

export function isNativeMutation(record: MutationRecord): boolean {
  const ElementType = record.target.ownerDocument?.defaultView?.Element;
  if (
    ElementType &&
    record.target instanceof ElementType &&
    record.target.closest(injectedSelector)
  ) {
    return false;
  }
  if (record.type === 'attributes') return true;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.some(
    (node) =>
      !ElementType ||
      !(node instanceof ElementType) ||
      !node.matches(injectedSelector),
  );
}

function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute(ariaLabel);
  if (label !== null) return label;
  const labelledBy = element.getAttribute(ariaLabelledBy);
  if (labelledBy === null) return '';
  return labelledBy
    .split(/\s+/v)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

function listenForDismissal(root: Document): void {
  if (dismissingDocuments.has(root)) return;
  dismissingDocuments.add(root);
  // Capture phase: runs before the click that may show the next toast.
  const dismiss = (): void => {
    for (const snackbar of root.querySelectorAll<HTMLElement>(
      `${snackbarSelector}[data-diffseek-snackbar-settled="true"]`,
    )) {
      dismissSnackbar(snackbar);
    }
  };
  root.addEventListener(
    'pointerdown',
    (event) => {
      // Clicking a toast closes it at once, progress included; a click
      // anywhere else hides only toasts past their minimum time.
      const target = event.target;
      const toast =
        target instanceof Element
          ? target.closest<HTMLElement>(snackbarSelector)
          : null;
      dismissSnackbar(toast);
      dismiss();
    },
    { capture: true },
  );
  root.addEventListener('keydown', dismiss, { capture: true });
  root.addEventListener('wheel', dismiss, { capture: true, passive: true });
}

function menuMatchesFilter(root: Document, menu: HTMLElement): boolean {
  if (menu.getAttribute(ariaLabel) === filterOptions) return true;
  const labelledBy = menu.getAttribute(ariaLabelledBy);
  return (
    labelledBy !== null &&
    root.getElementById(labelledBy)?.textContent === filterOptions
  );
}

function placeStatus(root: Document, status: HTMLElement): void {
  const trigger = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => accessibleName(button) === filterOptions,
  );
  const anchor =
    trigger ??
    root.querySelector<HTMLElement>('[role="tree"][aria-label="File Tree"]');
  anchor?.after(status);
}

/** A newer toast replaces finished ones; the live region stays mounted. */
function replaceStatusSnackbars(root: Document): void {
  for (const snackbar of root.querySelectorAll<HTMLElement>(
    `${snackbarSelector}[data-diffseek-snackbar-kind="status"]`,
  )) {
    snackbar.remove();
  }
}
