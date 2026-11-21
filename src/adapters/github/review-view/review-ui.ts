import type { FilterDefaultState } from '@diffseek/browser';

import { fileTreeElement } from '../review-page/page-adapter';
import {
  type ActionResult,
  clearViewedAction,
  type ViewedTarget,
} from '../review-page/viewed-actions';

/** The one product timer that paces UI: the shortest time a toast stays up. */
const snackbarMinimumMs = 5_000;
export const filterOptionsLabel = 'Filter options';
const markFilesFailed = "Couldn't mark files viewed. Try again.";

export function menuNeedsRemount(menu: HTMLElement): boolean {
  if (menu.dataset.diffseekMenuOwned !== 'true') return true;
  if (!menu.querySelector(':scope > [data-diffseek="filters"]')) return true;
  return [...menu.children].some(
    (child) =>
      child instanceof HTMLElement &&
      child.dataset.diffseek !== 'filters' &&
      child.hidden === false,
  );
}

export function filterMenus(root: Document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="menu"]')].filter(
    (menu) => {
      if (menu.getAttribute('aria-label') === filterOptionsLabel) return true;
      const labelledBy = menu.getAttribute('aria-labelledby');
      return (
        labelledBy != null &&
        root.getElementById(labelledBy)?.textContent === filterOptionsLabel
      );
    },
  );
}

export function removeInjected(root: Document): void {
  root.documentElement.removeAttribute('data-diffseek-filtered');
  for (const element of root.querySelectorAll(
    '[data-diffseek="filters"], [data-diffseek="unavailable"], [data-diffseek="snackbars"], [data-diffseek="filter-button-reset"]',
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
    failed: markFilesFailed,
  },
  category: {
    progress: 'Marking all files in category viewed…',
    done: 'All files in category marked viewed',
    failed: markFilesFailed,
  },
  'auto-view': {
    progress: 'Auto-view: marking generated files viewed…',
    done: 'Auto-view: generated files marked viewed',
    failed: markFilesFailed,
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
    replaceStatusSnackbars(root);
    progress.textContent = message;
    settleAfterMinimum(progress);
    progress.parentElement?.append(progress);
    return;
  }
  showSnackbar(root, message);
}

type AutoViewNotice = {
  started(): void;
  /** `null` means the batch was cancelled and has no outcome. */
  finished(result: ActionResult | null): void;
  /** Every generated file is viewed or tried and no batch is running. */
  done(): void;
  cancel(): void;
};

/**
 * One toast for a whole auto-view run. GitHub streams files in, so auto-view
 * runs as many small batches; each used to mount its own progress toast and
 * flip it to the outcome, which flickered twice a second. Batches now share
 * one toast that is never remounted. It shows progress until the session
 * reports that every generated file in the pull is viewed or was tried, then
 * the outcome once. A file that loads after that starts a new run.
 */
export function autoViewNotice(root: Document): AutoViewNotice {
  const messages = markMessages['auto-view'];
  let toast: HTMLElement | null = null;
  let outcome: string | null = null;
  const inProgress = () =>
    toast?.isConnected === true && toast.dataset.diffseekSnackbarKind === 'progress';
  return {
    started() {
      if (inProgress()) return;
      outcome = null;
      toast = showSnackbar(root, messages.progress ?? messages.done, 'progress');
    },
    finished(result) {
      if (!result) return;
      outcome =
        result.failed.length > 0 || outcome === messages.failed
          ? messages.failed
          : messages.done;
    },
    done() {
      if (!toast || !inProgress()) return;
      if (outcome === null) {
        dismissSnackbar(toast);
        return;
      }
      replaceStatusSnackbars(root);
      toast.textContent = outcome;
      settleAfterMinimum(toast);
    },
    cancel() {
      if (inProgress()) dismissSnackbar(toast);
    },
  };
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
  if (kind === 'status') settleAfterMinimum(snackbar);
  return snackbar;
}

function settleAfterMinimum(snackbar: HTMLElement): void {
  snackbar.dataset.diffseekSnackbarKind = 'status';
  delete snackbar.dataset.diffseekSnackbarSettled;
  const view = snackbar.ownerDocument.defaultView;
  view?.setTimeout(() => {
    if (snackbar.isConnected) snackbar.dataset.diffseekSnackbarSettled = 'true';
  }, snackbarMinimumMs);
}

const dismissingDocuments = new WeakSet<Document>();

function listenForDismissal(root: Document): void {
  if (dismissingDocuments.has(root)) return;
  dismissingDocuments.add(root);
  // Capture phase: runs before the click that may show the next toast.
  const dismiss = () => {
    for (const snackbar of root.querySelectorAll<HTMLElement>(
      '[data-diffseek="snackbar"][data-diffseek-snackbar-settled="true"]',
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

/** A newer toast replaces finished ones; the live region stays mounted. */
function replaceStatusSnackbars(root: Document): void {
  for (const snackbar of root.querySelectorAll<HTMLElement>(
    '[data-diffseek="snackbar"][data-diffseek-snackbar-kind="status"]',
  )) {
    snackbar.remove();
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

/**
 * GitHub's Filter options button, by accessible name. GitHub server-renders a
 * copy and swaps in the interactive one, which carries Primer's CSS anchor
 * name; that one wins.
 */
/** Candidates for GitHub's Filter options trigger, including the static copy. */
export const filterOptionsCandidateSelector =
  'button[aria-haspopup], button[aria-label]';

export function filterOptionsButton(root: Document): HTMLButtonElement | null {
  const named = [
    ...root.querySelectorAll<HTMLButtonElement>(filterOptionsCandidateSelector),
  ].filter(isFilterOptionsTrigger);
  return named.find((button) => cssAnchorName(button) != null) ?? named[0] ?? null;
}

export function isFilterOptionsTrigger(button: HTMLButtonElement): boolean {
  return accessibleName(button) === filterOptionsLabel;
}

/** The CSS anchor name Primer sets inline on an overlay's trigger. */
export function cssAnchorName(element: Element): string | null {
  return /anchor-name:\s*([^;,\s]+)/.exec(element.getAttribute('style') ?? '')?.[1] ?? null;
}

function placeStatus(root: Document, status: HTMLElement): void {
  const anchor = filterOptionsButton(root) ?? fileTreeElement(root);
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
