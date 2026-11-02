import {
  bucketActionPaths,
  type CountBucket,
  emptyFacetExclusions,
  type FileRecord,
  fileViewedLabel,
  type FilterState,
  includeCountedFiles,
  ReviewIndex,
  scopeAriaPressed,
  scopeViewedLabel,
} from '@diffseek/review';

import { type PageSnapshot, viewedControlState } from './page-adapter';

/** How long a native click may go unanswered before it counts as ignored. */
const ignoredClickGuardMs = 1_500;

const actionHandlers = new WeakMap<Element, () => void>();
const ariaLabel = 'aria-label';
const ariaPressed = 'aria-pressed';
const hitSlopPx = 4;
const listeningDocuments = new WeakSet<Document>();
const titleAttribute = 'title';
const viewedActionAttribute = 'data-diffseek-viewed-action';
const viewedActionClass = 'diffseek-viewed-icon-anchor';
const viewedActionSelector = '[data-diffseek-viewed-action]';
const viewedPartialClass = 'diffseek-viewed-partial';

export interface ActionResult {
  completed: string[];
  failed: string[];
  requested: number;
}

/** What a viewed batch covers; picks the toast wording. */
export type ViewedTarget = 'auto-view' | 'category' | 'file' | 'folder';

interface MarkOptions {
  onProgress?: (completed: number, requested: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

interface ViewedWait {
  button: HTMLButtonElement;
  resolveButton: () => HTMLButtonElement | null;
  signal?: AbortSignal;
  timeoutMs: number;
  viewed: boolean;
}

/**
 * Viewed toggles are drawn with CSS on GitHub's existing file/folder icon
 * wrapper; no nodes are inserted into the React-owned tree (inserting nodes
 * before hydration finishes makes React discard and remount the whole tree).
 */
export function clearViewedAction(anchor: Element): void {
  actionHandlers.delete(anchor);
  anchor.classList.remove(viewedActionClass, viewedPartialClass);
  if (anchor.getAttribute('class') === '') anchor.removeAttribute('class');
  for (const name of [
    viewedActionAttribute,
    ariaLabel,
    ariaPressed,
    titleAttribute,
  ]) {
    anchor.removeAttribute(name);
  }
}

export async function markViewed(
  snapshot: SupportedSnapshot,
  paths: string[],
  viewed: boolean,
  options: MarkOptions = {},
): Promise<ActionResult> {
  const result: ActionResult = {
    completed: [],
    failed: [],
    requested: paths.length,
  };
  for (const path of paths) {
    if (options.signal?.aborted === true) break;
    await markPath(snapshot, path, viewed, { options, result });
  }
  return result;
}

export function mountViewedActions(
  snapshot: SupportedSnapshot,
  onAction: (target: ViewedTarget, viewed: boolean, paths: string[]) => void,
  index = new ReviewIndex(snapshot.files),
  filters: FilterState = emptyFacetExclusions(),
): void {
  const tree = snapshot.tree();
  if (!tree) return;
  listenForViewedActions(tree.ownerDocument);
  const stale = new Set(
    tree.querySelectorAll<HTMLElement>(viewedActionSelector),
  );
  const counts = includeCountedFiles(filters);
  const folders = index.folderViewed(counts);
  const filesByPath = new Map(snapshot.files.map((file) => [file.path, file]));
  for (const item of tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')) {
    const file = filesByPath.get(item.id);
    const bucket = file ? fileBucket(file, counts) : folders.get(item.id);
    if (!bucket || bucket.counted === 0) continue;
    const anchor = iconAnchor(item);
    if (!anchor) continue;
    stale.delete(anchor);
    bindViewedAnchor(anchor, bucket, file !== undefined, onAction);
  }
  for (const anchor of stale) clearViewedAction(anchor);
}

function bindViewedAnchor(
  anchor: HTMLElement,
  bucket: CountBucket,
  file: boolean,
  onAction: (target: ViewedTarget, viewed: boolean, paths: string[]) => void,
): void {
  if (!anchor.classList.contains(viewedActionClass)) {
    anchor.classList.add(viewedActionClass);
  }
  setAttribute(anchor, viewedActionAttribute, 'true');
  const label = file
    ? fileViewedLabel(bucket.viewed === bucket.counted)
    : scopeViewedLabel(bucket.viewed, bucket.counted);
  const pressed = pressedValue(file, bucket);
  setAttribute(anchor, ariaLabel, label);
  setAttribute(anchor, ariaPressed, pressed);
  setAttribute(anchor, titleAttribute, label);
  anchor.classList.toggle(viewedPartialClass, pressed === 'mixed');
  const paths = bucketActionPaths(bucket);
  const marking = pressed !== 'true';
  actionHandlers.set(anchor, () => {
    onAction(file ? 'file' : 'folder', marking, paths);
  });
}

function fileBucket(
  file: FileRecord,
  counts: (candidate: FileRecord) => boolean,
): CountBucket | null {
  if (!counts(file)) return null;
  return {
    counted: 1,
    countedPaths: [file.path],
    unreadPaths: file.viewed ? [] : [file.path],
    viewed: file.viewed ? 1 : 0,
  };
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

function isPageElement(target: EventTarget | null): target is Element {
  if (!(target instanceof Node) || target.ownerDocument === null) return false;
  const ownerDocument = target.ownerDocument;
  const ElementType = ownerDocument.defaultView?.Element;
  return ElementType !== undefined && target instanceof ElementType;
}

function isViewed(button: HTMLButtonElement): boolean {
  return viewedControlState(button) === true;
}

function listenForViewedActions(document: Document): void {
  if (listeningDocuments.has(document)) return;
  listeningDocuments.add(document);
  document.addEventListener('click', onViewedActionClick, { capture: true });
}

async function markPath(
  snapshot: SupportedSnapshot,
  path: string,
  viewed: boolean,
  attempt: { options: MarkOptions; result: ActionResult },
): Promise<void> {
  const { options, result } = attempt;
  const resolveButton = (): HTMLButtonElement | null =>
    snapshot.viewedControl(path);
  const button = resolveButton();
  if (!button) {
    result.failed.push(path);
    report(
      options,
      result.completed.length + result.failed.length,
      result.requested,
    );
    return;
  }
  if (isViewed(button) === viewed) {
    result.completed.push(path);
    report(options, result.completed.length, result.requested);
    return;
  }
  const confirmed = waitForViewedState({
    button,
    resolveButton,
    timeoutMs: options.timeoutMs ?? ignoredClickGuardMs,
    viewed,
    ...(options.signal !== undefined && { signal: options.signal }),
  });
  button.click();
  if (await confirmed) {
    const file = snapshot.files.find((candidate) => candidate.path === path);
    if (file) file.viewed = viewed;
    result.completed.push(path);
  } else {
    result.failed.push(path);
  }
  report(
    options,
    result.completed.length + result.failed.length,
    result.requested,
  );
}

function onViewedActionClick(event: MouseEvent): void {
  const target = event.target;
  if (!isPageElement(target)) return;
  const anchor = target.closest(viewedActionSelector);
  if (!anchor) return;
  const handler = actionHandlers.get(anchor);
  if (!handler || !withinHitArea(anchor, event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  handler();
}

function pressedValue(file: boolean, bucket: CountBucket): string {
  if (!file) return scopeAriaPressed(bucket.viewed, bucket.counted);
  if (bucket.viewed === bucket.counted) return 'true';
  return 'false';
}

function report(options: MarkOptions, completed: number, requested: number): void {
  options.onProgress?.(completed, requested);
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function waitForViewedState(wait: ViewedWait): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      wait.signal?.removeEventListener('abort', abort);
      resolve(confirmed);
    };
    const check = (): void => {
      const current = wait.resolveButton();
      if (current && isViewed(current) === wait.viewed) finish(true);
    };
    const root =
      wait.button.closest('[role="region"]') ??
      wait.button.closest('[data-diff-header-wrapper="true"]') ??
      wait.button;
    const observer = new MutationObserver(check);
    observer.observe(root, {
      attributeFilter: [ariaLabel, ariaPressed],
      attributes: true,
      childList: true,
      subtree: true,
    });
    // Failure guard only: success is the attribute change above; nothing
    // signals a click GitHub ignored.
    const timeout = setTimeout(() => {
      finish(false);
    }, wait.timeoutMs);
    const abort = (): void => {
      finish(false);
    };
    wait.signal?.addEventListener('abort', abort, { once: true });
    queueMicrotask(check);
  });
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
