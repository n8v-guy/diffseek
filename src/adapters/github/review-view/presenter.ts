import {
  type FilterState,
  matchesFilters,
  ReviewIndex,
} from '@diffseek/review';

import { fileToggleAction, type PageSnapshot } from '../review-page/page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;
type CollapseAction = NonNullable<ReturnType<typeof fileToggleAction>>;
type Locator = {
  document: Document;
  resolve: () => HTMLButtonElement | null;
};
type PendingTransition = {
  controller: AbortController;
  ownsCollapse: boolean;
};
type QueuedTransition = {
  path: string;
  expected: CollapseAction;
  ownsCollapse: boolean;
};

export class ReviewPresenter {
  private readonly autoCollapsed = new Set<string>();
  private readonly desiredCollapsed = new Map<string, boolean>();
  private readonly locators = new Map<string, Locator>();
  private readonly pending = new Map<string, PendingTransition>();
  private readonly queue: QueuedTransition[] = [];
  private draining = false;

  apply(
    snapshot: SupportedSnapshot,
    filters: FilterState,
    index = new ReviewIndex(snapshot.files),
  ): void {
    const matching = new Set(
      snapshot.files
        .filter((file) => matchesFilters(file, filters))
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
        if (region.dataset.diffseekFilteredOut != null) {
          delete region.dataset.diffseekFilteredOut;
        }
        this.restore(file.path);
      } else {
        if (region.dataset.diffseekFilteredOut !== 'true') {
          region.dataset.diffseekFilteredOut = 'true';
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
      delete region.dataset.diffseekFilteredOut;
      this.restore(path);
    }

    const tree = snapshot.tree();
    for (const item of tree?.querySelectorAll<HTMLElement>(
      '[role="treeitem"][id]',
    ) ?? []) {
      item.hidden = false;
    }
  }

  reset(snapshot?: SupportedSnapshot | null): void {
    if (snapshot) {
      for (const file of snapshot.files) {
        const treeItem = snapshot.treeItem(file.path);
        const region = snapshot.region(file.path);
        if (treeItem) treeItem.hidden = false;
        if (region) delete region.dataset.diffseekFilteredOut;
      }
    }
    this.queue.length = 0;
    const owned = new Set(this.autoCollapsed);
    for (const [path, transition] of this.pending) {
      transition.controller.abort();
      if (transition.ownsCollapse) owned.add(path);
    }
    for (const path of owned) {
      const button = this.resolve(path);
      if (button && fileToggleAction(button) === 'Expand file') button.click();
    }
    this.pending.clear();
    this.autoCollapsed.clear();
    this.desiredCollapsed.clear();
    this.locators.clear();
  }

  private collapse(path: string): void {
    const button = this.resolve(path);
    if (!button) return;
    if (fileToggleAction(button) === 'Expand file') return;
    this.enqueue(path, 'Expand file', true);
  }

  private restore(path: string): void {
    if (!this.autoCollapsed.has(path)) return;
    const button = this.resolve(path);
    if (!button || fileToggleAction(button) === 'Collapse file') {
      this.autoCollapsed.delete(path);
      return;
    }
    this.enqueue(path, 'Collapse file', false);
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
    if (existing >= 0) this.queue.splice(existing, 1);
    this.queue.push({ path, expected, ownsCollapse });
    void this.drain();
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
      await this.transition(job.path, button, job.expected, job.ownsCollapse);
    }
    this.draining = false;
    if (this.queue.length > 0) void this.drain();
  }

  private async transition(
    path: string,
    button: HTMLButtonElement,
    expected: CollapseAction,
    ownsCollapse: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    const transition = { controller, ownsCollapse };
    this.pending.set(path, transition);
    const confirmed = this.waitForAction(path, button, expected, controller.signal);
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

  private waitForAction(
    path: string,
    button: HTMLButtonElement,
    expected: CollapseAction,
    signal: AbortSignal,
  ): Promise<boolean> {
    const locator = this.locators.get(path);
    if (!locator) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const check = () => {
        const current = this.resolve(path);
        if (current && fileToggleAction(current) === expected) finish(true);
      };
      const abort = () => finish(false);
      const observer = new MutationObserver(check);
      const root =
        button.closest('[role="region"]') ??
        button.closest('[data-diff-header-wrapper="true"]') ??
        button;
      observer.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['aria-label', 'aria-labelledby', 'class'],
      });
      const timeout = setTimeout(() => finish(false), 1_500);
      signal.addEventListener('abort', abort, { once: true });
      queueMicrotask(check);
    });
  }

  private resolve(path: string): HTMLButtonElement | null {
    return this.locators.get(path)?.resolve() ?? null;
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
      '[role="treeitem"][id]',
    ) ?? []) {
      if (filePaths.has(item.id)) continue;
      const hide = !visible.has(item.id);
      if (item.hidden !== hide) item.hidden = hide;
    }
  }
}
