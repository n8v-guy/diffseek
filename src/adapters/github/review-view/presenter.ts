import {
  type FilterState,
  matchesFacets,
  ReviewIndex,
} from '@diffseek/review';

import { fileToggleAction, type PageSnapshot } from '../review-page/page-adapter';

const collapseFile = 'Collapse file';
const expandFile = 'Expand file';
/** How long a native click may go unanswered before it counts as ignored. */
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
interface QueuedTransition {
  expected: CollapseAction;
  ownsCollapse: boolean;
  path: string;
}
type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export class ReviewPresenter {
  private readonly autoCollapsed = new Set<string>();
  private readonly desiredCollapsed = new Map<string, boolean>();
  private draining = false;
  private readonly locators = new Map<string, Locator>();
  private readonly pending = new Map<string, PendingTransition>();
  private readonly queue: QueuedTransition[] = [];

  apply(
    snapshot: SupportedSnapshot,
    filters: FilterState,
    index = new ReviewIndex(snapshot.files),
  ): void {
    const matching = new Set(
      snapshot.files
        .filter((file) => matchesFacets(file.labels, filters))
        .map((file) => file.path),
    );

    for (const file of snapshot.files) {
      const treeItem = snapshot.treeItem(file.path);
      const region = snapshot.region(file.path);
      if (!treeItem || !region) continue;
      this.locators.set(file.path, {
        document: region.ownerDocument,
        resolve: () => snapshot.collapseControl(file.path),
      });

      const matches =
        !snapshot.collapseControl(file.path) || matching.has(file.path);
      const wantCollapsed = !matches;
      this.desiredCollapsed.set(file.path, wantCollapsed);
      if (treeItem.hidden !== wantCollapsed) treeItem.hidden = wantCollapsed;
      if (matches) {
        if (region.dataset['diffseekFilteredOut'] !== undefined) {
          delete region.dataset['diffseekFilteredOut'];
        }
        this.restore(file.path);
      } else {
        if (region.dataset['diffseekFilteredOut'] !== 'true') {
          region.dataset['diffseekFilteredOut'] = 'true';
        }
        this.collapse(file.path);
      }
    }

    this.updateFolders(snapshot, matching, index);
  }

  clear(snapshot: SupportedSnapshot): void {
    for (const file of snapshot.files) {
      const path = file.path;
      const treeItem = snapshot.treeItem(path);
      const region = snapshot.region(path);
      if (!treeItem || !region) continue;
      this.locators.set(path, {
        document: region.ownerDocument,
        resolve: () => snapshot.collapseControl(path),
      });
      this.desiredCollapsed.set(path, false);
      treeItem.hidden = false;
      delete region.dataset['diffseekFilteredOut'];
      this.restore(path);
    }

    const tree = snapshot.tree();
    for (const item of tree?.querySelectorAll<HTMLElement>(
      treeItemSelector,
    ) ?? []) {
      item.hidden = false;
    }
  }

  reset(snapshot?: null | SupportedSnapshot): void {
    if (snapshot) revealSnapshot(snapshot);
    this.queue.length = 0;
    const owned = new Set(this.autoCollapsed);
    for (const [path, transition] of this.pending) {
      transition.controller.abort();
      if (transition.ownsCollapse) owned.add(path);
    }
    for (const path of owned) {
      const button = this.resolve(path);
      if (button && fileToggleAction(button) === expandFile) button.click();
    }
    this.pending.clear();
    this.autoCollapsed.clear();
    this.desiredCollapsed.clear();
    this.locators.clear();
  }

  private collapse(path: string): void {
    const button = this.resolve(path);
    if (!button || (fileToggleAction(button) === expandFile)) return;
    this.enqueue(path, expandFile, true);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;
      const wantCollapsed = this.desiredCollapsed.get(job.path) === true;
      if (job.ownsCollapse !== wantCollapsed) continue;
      const button = this.resolve(job.path);
      if (!button) continue;
      if (fileToggleAction(button) === job.expected) {
        if (!job.ownsCollapse) this.autoCollapsed.delete(job.path);
        continue;
      }
      await this.transition(button, job);
    }
    this.draining = false;
    if (this.queue.length > 0) void this.drain();
  }

  private enqueue(
    path: string,
    expected: CollapseAction,
    ownsCollapse: boolean,
  ): void {
    const pending = this.pending.get(path);
    if (pending) {
      const button = this.resolve(path);
      if (
        pending.ownsCollapse === ownsCollapse &&
        button &&
        fileToggleAction(button) === expected
      ) {
        return;
      }
      pending.controller.abort();
      this.pending.delete(path);
    }
    const existing = this.queue.findIndex((job) => job.path === path);
    if (existing !== -1) this.queue.splice(existing, 1);
    this.queue.push({ expected, ownsCollapse, path });
    void this.drain();
  }

  private resolve(path: string): HTMLButtonElement | null {
    return this.locators.get(path)?.resolve() ?? null;
  }

  private restore(path: string): void {
    if (!this.autoCollapsed.has(path)) return;
    const button = this.resolve(path);
    if (!button || fileToggleAction(button) === collapseFile) {
      this.autoCollapsed.delete(path);
      return;
    }
    this.enqueue(path, collapseFile, false);
  }

  private async transition(
    button: HTMLButtonElement,
    job: QueuedTransition,
  ): Promise<void> {
    const { ownsCollapse, path } = job;
    const controller = new AbortController();
    const transition = { controller, ownsCollapse };
    this.pending.set(path, transition);
    const confirmed = this.waitForAction(button, job, controller.signal);
    button.click();
    const applied = await confirmed;
    if (this.pending.get(path) !== transition) return;
    this.pending.delete(path);
    if (!applied) return;

    if (ownsCollapse) {
      this.autoCollapsed.add(path);
      if (this.desiredCollapsed.get(path) === false) this.restore(path);
    } else {
      this.autoCollapsed.delete(path);
      if (this.desiredCollapsed.get(path) === true) this.collapse(path);
    }
  }

  private updateFolders(
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
    for (const item of tree?.querySelectorAll<HTMLElement>(
      treeItemSelector,
    ) ?? []) {
      if (filePaths.has(item.id)) continue;
      const hide = !visible.has(item.id);
      if (item.hidden !== hide) item.hidden = hide;
    }
  }

  private waitForAction(
    button: HTMLButtonElement,
    { expected, path }: QueuedTransition,
    signal: AbortSignal,
  ): Promise<boolean> {
    const locator = this.locators.get(path);
    if (!locator) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const check = (): void => {
        const current = this.resolve(path);
        if (current && fileToggleAction(current) === expected) finish(true);
      };
      const abort = (): void => { finish(false); };
      const observer = new MutationObserver(check);
      const root =
        button.closest('[role="region"]') ??
        button.closest('[data-diff-header-wrapper="true"]') ??
        button;
      observer.observe(root, {
        attributeFilter: ['aria-label', 'aria-labelledby', 'class'],
        attributes: true,
        childList: true,
        subtree: true,
      });
      // Failure guard only: GitHub may ignore a click (e.g. on a control it is
      // about to replace) and nothing signals that. Success is the mutation.
      const timeout = setTimeout(() => { finish(false); }, ignoredClickGuardMs);
      signal.addEventListener('abort', abort, { once: true });
      queueMicrotask(check);
    });
  }
}

function revealSnapshot(snapshot: SupportedSnapshot): void {
  for (const file of snapshot.files) {
    const treeItem = snapshot.treeItem(file.path);
    const region = snapshot.region(file.path);
    if (treeItem) treeItem.hidden = false;
    if (region) delete region.dataset['diffseekFilteredOut'];
  }
}
