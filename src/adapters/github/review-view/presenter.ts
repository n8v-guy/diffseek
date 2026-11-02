import { type FilterState, matchesFacets, ReviewIndex } from '@diffseek/review';

import { clearDataAttribute, dataAttribute, setDataAttribute } from '../dom-data';
import {
  fileToggleAction,
  type PageSnapshot,
} from '../review-page/page-adapter';

/** How long a native click may go unanswered before it counts as ignored. */
const ariaLabel = 'aria-label';
const collapseFile = 'Collapse file';
const expandFile = 'Expand file';
const ignoredClickGuardMs = 1_500;
const treeItemSelector = '[role="treeitem"][id]';

type CollapseAction = NonNullable<ReturnType<typeof fileToggleAction>>;
interface Locator {
  document: Document;
  resolve: () => HTMLButtonElement | null;
}
interface PendingTransition {
  controller: AbortController;
  ownsCollapse: boolean;
}
interface PresenterState {
  autoCollapsed: Set<string>;
  desiredCollapsed: Map<string, boolean>;
  draining: boolean;
  locators: Map<string, Locator>;
  pending: Map<string, PendingTransition>;
  queue: QueuedTransition[];
}
interface QueuedTransition {
  expected: CollapseAction;
  ownsCollapse: boolean;
  path: string;
}
type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export class ReviewPresenter {
  private readonly state: PresenterState = {
    autoCollapsed: new Set(),
    desiredCollapsed: new Map(),
    draining: false,
    locators: new Map(),
    pending: new Map(),
    queue: [],
  };

  apply(
    snapshot: SupportedSnapshot,
    filters: FilterState,
    index = new ReviewIndex(snapshot.files),
  ): void {
    applySnapshot(this.state, snapshot, filters, index);
  }

  clear(snapshot: SupportedSnapshot): void {
    clearSnapshot(this.state, snapshot);
  }

  reset(snapshot?: null | SupportedSnapshot): void {
    resetSnapshot(this.state, snapshot);
  }
}

function abandonPending(state: PresenterState, owned: Set<string>): void {
  for (const [path, pendingTransition] of state.pending) {
    pendingTransition.controller.abort();
    if (pendingTransition.ownsCollapse) owned.add(path);
  }
}

function applyFile(
  state: PresenterState,
  snapshot: SupportedSnapshot,
  file: SupportedSnapshot['files'][number],
  matching: Set<string>,
): void {
  const treeItem = snapshot.treeItem(file.path);
  const region = snapshot.region(file.path);
  if (!treeItem || !region) return;
  state.locators.set(file.path, {
    document: region.ownerDocument,
    resolve: () => snapshot.collapseControl(file.path),
  });
  const matches = !snapshot.collapseControl(file.path) || matching.has(file.path);
  const wantCollapsed = !matches;
  state.desiredCollapsed.set(file.path, wantCollapsed);
  if (treeItem.hidden !== wantCollapsed) treeItem.hidden = wantCollapsed;
  if (matches) {
    if (dataAttribute(region, 'diffseekFilteredOut') !== undefined) {
      clearDataAttribute(region, 'diffseekFilteredOut');
    }
    restore(state, file.path);
    return;
  }
  if (dataAttribute(region, 'diffseekFilteredOut') !== 'true') {
    setDataAttribute(region, 'diffseekFilteredOut', 'true');
  }
  collapse(state, file.path);
}

function applySnapshot(
  state: PresenterState,
  snapshot: SupportedSnapshot,
  filters: FilterState,
  index: ReviewIndex,
): void {
  const matching = new Set(
    snapshot.files
      .filter((file) => matchesFacets(file.labels, filters))
      .map((file) => file.path),
  );
  for (const file of snapshot.files) applyFile(state, snapshot, file, matching);
  updateFolders(snapshot, matching, index);
}

function clearFile(
  state: PresenterState,
  snapshot: SupportedSnapshot,
  file: SupportedSnapshot['files'][number],
): void {
  const path = file.path;
  const treeItem = snapshot.treeItem(path);
  const region = snapshot.region(path);
  if (!treeItem || !region) return;
  state.locators.set(path, {
    document: region.ownerDocument,
    resolve: () => snapshot.collapseControl(path),
  });
  state.desiredCollapsed.set(path, false);
  treeItem.hidden = false;
  clearDataAttribute(region, 'diffseekFilteredOut');
  restore(state, path);
}

function clearSnapshot(state: PresenterState, snapshot: SupportedSnapshot): void {
  for (const file of snapshot.files) clearFile(state, snapshot, file);
  const tree = snapshot.tree();
  for (const item of tree?.querySelectorAll<HTMLElement>(treeItemSelector) ?? []) {
    item.hidden = false;
  }
}

function collapse(state: PresenterState, path: string): void {
  const button = resolve(state, path);
  if (!button || fileToggleAction(button) === expandFile) return;
  enqueue(state, path, expandFile, true);
}

async function drain(state: PresenterState): Promise<void> {
  if (state.draining) return;
  state.draining = true;
  while (state.queue.length > 0) {
    const job = state.queue.shift();
    if (!job) continue;
    const wantCollapsed = state.desiredCollapsed.get(job.path) === true;
    if (job.ownsCollapse !== wantCollapsed) continue;
    const button = resolve(state, job.path);
    if (!button) continue;
    if (fileToggleAction(button) === job.expected) {
      if (!job.ownsCollapse) state.autoCollapsed.delete(job.path);
      continue;
    }
    await transition(state, job.path, button, job);
  }
  state.draining = false;
  if (state.queue.length > 0) void drain(state);
}

function enqueue(
  state: PresenterState,
  path: string,
  expected: CollapseAction,
  ownsCollapse: boolean,
): void {
  const pending = state.pending.get(path);
  if (pending) {
    const button = resolve(state, path);
    if (
      pending.ownsCollapse === ownsCollapse &&
      button &&
      fileToggleAction(button) === expected
    ) {
      return;
    }
    pending.controller.abort();
    state.pending.delete(path);
  }
  const existing = state.queue.findIndex((job) => job.path === path);
  if (existing !== -1) state.queue.splice(existing, 1);
  state.queue.push({ expected, ownsCollapse, path });
  void drain(state);
}

function expandOwned(state: PresenterState, owned: ReadonlySet<string>): void {
  for (const path of owned) {
    const button = resolve(state, path);
    if (button && fileToggleAction(button) === expandFile) button.click();
  }
}

function resetSnapshot(
  state: PresenterState,
  snapshot: null | SupportedSnapshot | undefined,
): void {
  revealSnapshot(snapshot);
  state.queue.length = 0;
  const owned = new Set(state.autoCollapsed);
  abandonPending(state, owned);
  expandOwned(state, owned);
  state.pending.clear();
  state.autoCollapsed.clear();
  state.desiredCollapsed.clear();
  state.locators.clear();
}

function resolve(state: PresenterState, path: string): HTMLButtonElement | null {
  return state.locators.get(path)?.resolve() ?? null;
}

function restore(state: PresenterState, path: string): void {
  if (!state.autoCollapsed.has(path)) return;
  const button = resolve(state, path);
  if (!button || fileToggleAction(button) === collapseFile) {
    state.autoCollapsed.delete(path);
    return;
  }
  enqueue(state, path, collapseFile, false);
}

function revealSnapshot(snapshot: null | SupportedSnapshot | undefined): void {
  if (!snapshot) return;
  for (const file of snapshot.files) {
    const treeItem = snapshot.treeItem(file.path);
    const region = snapshot.region(file.path);
    if (treeItem) treeItem.hidden = false;
    if (region) clearDataAttribute(region, 'diffseekFilteredOut');
  }
}

async function transition(
  state: PresenterState,
  path: string,
  button: HTMLButtonElement,
  job: QueuedTransition,
): Promise<void> {
  const controller = new AbortController();
  const current = { controller, ownsCollapse: job.ownsCollapse };
  state.pending.set(path, current);
  const confirmed = waitForAction(state, {
    button,
    expected: job.expected,
    path,
    signal: controller.signal,
  });
  button.click();
  const applied = await confirmed;
  if (state.pending.get(path) !== current) return;
  state.pending.delete(path);
  if (!applied) return;
  if (job.ownsCollapse) {
    state.autoCollapsed.add(path);
    if (state.desiredCollapsed.get(path) === false) restore(state, path);
    return;
  }
  state.autoCollapsed.delete(path);
  if (state.desiredCollapsed.get(path) === true) collapse(state, path);
}

function updateFolders(
  snapshot: SupportedSnapshot,
  matching: Set<string>,
  index: ReviewIndex,
): void {
  const visible = index.visibleItems([
    ...matching,
    ...snapshot.unavailable.keys(),
  ]);
  const tree = snapshot.tree();
  const filePaths = new Set(snapshot.files.map((file) => file.path));
  for (const item of tree?.querySelectorAll<HTMLElement>(treeItemSelector) ?? []) {
    if (filePaths.has(item.id)) continue;
    const hide = !visible.has(item.id);
    if (item.hidden !== hide) item.hidden = hide;
  }
}

function waitForAction(
  state: PresenterState,
  watch: {
    button: HTMLButtonElement;
    expected: CollapseAction;
    path: string;
    signal: AbortSignal;
  },
): Promise<boolean> {
  if (!state.locators.has(watch.path)) return Promise.resolve(false);
  return new Promise((_resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      watch.signal.removeEventListener('abort', abort);
      _resolve(value);
    };
    const check = (): void => {
      const current = resolve(state, watch.path);
      if (current && fileToggleAction(current) === watch.expected) finish(true);
    };
    const abort = (): void => {
      finish(false);
    };
    const observer = new MutationObserver(check);
    const root =
      watch.button.closest('[role="region"]') ??
      watch.button.closest('[data-diff-header-wrapper="true"]') ??
      watch.button;
    observer.observe(root, {
      attributeFilter: [ariaLabel, 'aria-labelledby', 'class'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    // Failure guard only: GitHub may ignore a click (e.g. on a control it is
    // about to replace) and nothing signals that. Success is the mutation.
    const timeout = setTimeout(() => {
      finish(false);
    }, ignoredClickGuardMs);
    watch.signal.addEventListener('abort', abort, { once: true });
    queueMicrotask(check);
  });
}
