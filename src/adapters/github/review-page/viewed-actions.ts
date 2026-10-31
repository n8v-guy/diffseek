import {
  bucketActionPaths,
  emptyFacetExclusions,
  fileViewedLabel,
  folderViewedNotice,
  includeCountedFiles,
  scopeAriaPressed,
  scopeViewedLabel,
  type CountBucket,
  type FileRecord,
  type FilterState,
  ReviewIndex,
} from '@diffseek/review';

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
const viewedPartialClass = 'diffseek-viewed-partial';
const actionHandlers = new WeakMap<Element, () => void>();
const listeningDocuments = new WeakSet<Document>();
const hitSlopPx = 4;

export function mountViewedActions(
  snapshot: SupportedSnapshot,
  onAction: (viewed: boolean, paths: string[], notice?: string) => void,
  index = new ReviewIndex(snapshot.files),
  filters: FilterState = emptyFacetExclusions(),
): void {
  const tree = snapshot.tree();
  if (!tree) return;
  listenForViewedActions(tree.ownerDocument);
  const stale = new Set(tree.querySelectorAll<HTMLElement>(viewedActionSelector));
  const counts = includeCountedFiles(filters);
  const folders = index.folderViewed(counts);
  const filesByPath = new Map(
    snapshot.files.map((file) => [file.path, file]),
  );

  for (const item of tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')) {
    const file = filesByPath.get(item.id);
    const bucket = file ? fileBucket(file, counts) : folders.get(item.id);
    if (!bucket || bucket.counted === 0) continue;
    const anchor = iconAnchor(item);
    if (!anchor) continue;
    stale.delete(anchor);
    bindViewedAnchor(anchor, bucket, file != null, item.id, onAction);
  }

  for (const anchor of stale) clearViewedAction(anchor);
}

function fileBucket(
  file: FileRecord,
  counts: (file: FileRecord) => boolean,
): CountBucket | null {
  if (!counts(file)) return null;
  const bucket = {
    counted: 1,
    viewed: file.viewed ? 1 : 0,
    unreadPaths: file.viewed ? [] : [file.path],
    countedPaths: [file.path],
  };
  return bucket;
}

function iconAnchor(item: HTMLElement): HTMLElement | null {
  const icon = [...item.querySelectorAll<SVGElement>('svg.octicon')].find(
    (candidate) =>
      candidate.closest('[role="treeitem"]') === item &&
      [...candidate.classList].some((name) => name.startsWith('octicon-file')),
  );
  // Draw on GitHub's icon wrapper; never on the treeitem itself.
  const anchor = icon?.parentElement;
  if (!anchor || anchor === item) return null;
  return anchor;
}

function bindViewedAnchor(
  anchor: HTMLElement,
  bucket: CountBucket,
  file: boolean,
  itemId: string,
  onAction: (viewed: boolean, paths: string[], notice?: string) => void,
): void {
  if (!anchor.classList.contains(viewedActionClass)) {
    anchor.classList.add(viewedActionClass);
  }
  setAttribute(anchor, 'data-diffseek-viewed-action', 'true');
  const label = file
    ? fileViewedLabel(bucket.viewed === bucket.counted)
    : scopeViewedLabel(bucket.viewed, bucket.counted);
  const pressed = file
    ? bucket.viewed === bucket.counted
      ? 'true'
      : 'false'
    : scopeAriaPressed(bucket.viewed, bucket.counted);
  setAttribute(anchor, 'aria-label', label);
  setAttribute(anchor, 'aria-pressed', pressed);
  setAttribute(anchor, 'title', label);
  anchor.classList.toggle(viewedPartialClass, pressed === 'mixed');
  const paths = bucketActionPaths(bucket);
  const markViewed = pressed !== 'true';
  const notice = file
    ? undefined
    : folderViewedNotice(
        itemId.split('/').at(-1) ?? itemId,
        markViewed,
        paths.length,
      );
  actionHandlers.set(anchor, () =>
    notice ? onAction(markViewed, paths, notice) : onAction(markViewed, paths),
  );
}

export function clearViewedAction(anchor: Element): void {
  actionHandlers.delete(anchor);
  anchor.classList.remove(viewedActionClass, viewedPartialClass);
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
