import { ReviewIndex } from '@diffseek/review';

import {
  type PageSnapshot,
  viewedControlState,
} from './page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export type ActionResult = {
  requested: number;
  completed: string[];
  failed: Array<{ path: string; reason: string }>;
};

export async function markViewed(
  snapshot: SupportedSnapshot,
  paths: string[],
  viewed: boolean,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (completed: number, requested: number) => void;
  } = {},
): Promise<ActionResult> {
  const result: ActionResult = {
    requested: paths.length,
    completed: [],
    failed: [],
  };

  for (const path of paths) {
    if (options.signal?.aborted) break;
    const resolveButton = () => viewedButtonFor(snapshot, path);
    const button = resolveButton();
    if (!button) {
      result.failed.push({ path, reason: 'Viewed control is unavailable' });
      options.onProgress?.(
        result.completed.length + result.failed.length,
        result.requested,
      );
      continue;
    }
    if (isViewed(button) === viewed) {
      result.completed.push(path);
      options.onProgress?.(result.completed.length, result.requested);
      continue;
    }

    const confirmed = waitForViewedState(
      resolveButton,
      button,
      viewed,
      options.timeoutMs ?? 1_500,
      options.signal,
    );
    button.click();
    if (await confirmed) {
      const file = snapshot.files.find((candidate) => candidate.path === path);
      if (file) file.viewed = viewed;
      result.completed.push(path);
    } else {
      result.failed.push({
        path,
        reason: 'GitHub did not confirm viewed state',
      });
    }
    options.onProgress?.(
      result.completed.length + result.failed.length,
      result.requested,
    );
  }

  return result;
}

/**
 * Viewed toggles are drawn with CSS on GitHub's existing file/folder icon
 * wrapper; no nodes are inserted into the React-owned tree (inserting nodes
 * before hydration finishes makes React discard and remount the whole tree).
 */
const viewedActionSelector = '[data-diffseek-viewed-action]';
const viewedActionClass = 'diffseek-viewed-icon-anchor';
const actionHandlers = new WeakMap<Element, () => void>();
const listeningDocuments = new WeakSet<Document>();
const hitSlopPx = 4;

export function mountViewedActions(
  snapshot: SupportedSnapshot,
  onAction: (viewed: boolean, paths: string[]) => void,
  index = new ReviewIndex(snapshot.files),
): void {
  const tree = snapshot.tree();
  if (!tree) return;
  listenForViewedActions(tree.ownerDocument);
  const stale = new Set(tree.querySelectorAll<HTMLElement>(viewedActionSelector));
  const filesByPath = new Map(
    snapshot.files.map((file) => [file.path, file]),
  );

  for (const item of tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')) {
    const paths = index
      .filesUnder(item.id)
      .filter((file) => file.capabilities.viewed)
      .map((file) => file.path);
    if (paths.length === 0) continue;

    const viewed = paths.every((path) => filesByPath.get(path)?.viewed);
    const icon = [...item.querySelectorAll<SVGElement>('svg.octicon')].find(
      (candidate) =>
        candidate.closest('[role="treeitem"]') === item &&
        [...candidate.classList].some((name) =>
          name.startsWith('octicon-file'),
        ),
    );
    // Draw on GitHub's icon wrapper; never on the treeitem itself.
    const anchor = icon?.parentElement;
    if (!anchor || anchor === item) continue;
    stale.delete(anchor);
    if (!anchor.classList.contains(viewedActionClass)) {
      anchor.classList.add(viewedActionClass);
    }
    setAttribute(anchor, 'data-diffseek-viewed-action', 'true');
    const label = viewed ? 'Mark as not viewed' : 'Mark as viewed';
    setAttribute(anchor, 'aria-label', label);
    setAttribute(anchor, 'aria-pressed', String(viewed));
    setAttribute(anchor, 'title', label);
    actionHandlers.set(anchor, () => onAction(!viewed, paths));
  }

  for (const anchor of stale) clearViewedAction(anchor);
}

export function clearViewedAction(anchor: Element): void {
  actionHandlers.delete(anchor);
  anchor.classList.remove(viewedActionClass);
  if (anchor.getAttribute('class') === '') anchor.removeAttribute('class');
  for (const name of [
    'data-diffseek-viewed-action',
    'aria-label',
    'aria-pressed',
    'title',
  ]) {
    anchor.removeAttribute(name);
  }
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function listenForViewedActions(document: Document): void {
  if (listeningDocuments.has(document)) return;
  listeningDocuments.add(document);
  document.addEventListener('click', onViewedActionClick, true);
}

function onViewedActionClick(event: MouseEvent): void {
  const target = event.target;
  const ElementType = (target as Node | null)?.ownerDocument?.defaultView?.Element;
  if (!ElementType || !(target instanceof ElementType)) return;
  const anchor = target.closest(viewedActionSelector);
  if (!anchor) return;
  const handler = actionHandlers.get(anchor);
  if (!handler || !withinHitArea(anchor, event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  handler();
}

function withinHitArea(anchor: Element, event: MouseEvent): boolean {
  // Synthetic/keyboard clicks carry no pointer position.
  if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) {
    return true;
  }
  const rect = anchor.getBoundingClientRect();
  return (
    event.clientX >= rect.left - hitSlopPx &&
    event.clientX <= rect.right + hitSlopPx &&
    event.clientY >= rect.top - hitSlopPx &&
    event.clientY <= rect.bottom + hitSlopPx
  );
}

function isViewed(button: HTMLButtonElement): boolean {
  return viewedControlState(button) === true;
}

function viewedButtonFor(
  snapshot: SupportedSnapshot,
  path: string,
): HTMLButtonElement | null {
  return snapshot.viewedControl(path);
}

function observationRoot(button: HTMLButtonElement): Element {
  return (
    button.closest('[role="region"]') ??
    button.closest('[data-diff-header-wrapper="true"]') ??
    button
  );
}

function waitForViewedState(
  resolveButton: () => HTMLButtonElement | null,
  button: HTMLButtonElement,
  viewed: boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve(confirmed);
    };
    const check = () => {
      const current = resolveButton();
      if (current && isViewed(current) === viewed) finish(true);
    };
    const observer = new MutationObserver(check);
    observer.observe(observationRoot(button), {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['aria-label', 'aria-pressed'],
    });
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    queueMicrotask(check);
  });
}
