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

export class ReviewPresenter {
  private readonly autoCollapsed = new Set<string>();
  private readonly desiredCollapsed = new Map<string, boolean>();
  private readonly locators = new Map<string, Locator>();
  private readonly pending = new Map<string, PendingTransition>();

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
      this.desiredCollapsed.set(file.path, !matches);
      treeItem.hidden = !matches;
      if (matches) {
        delete region.dataset.diffseekFilteredOut;
        this.restore(file.path);
      } else {
        region.dataset.diffseekFilteredOut = 'true';
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
    const pending = this.pending.get(path);
    if (pending) {
      if (!pending.ownsCollapse) return;
      pending.controller.abort();
      this.pending.delete(path);
    }
    this.autoCollapsed.delete(path);
    void this.transition(path, button, 'Expand file', true);
  }

  private restore(path: string): void {
    if (!this.autoCollapsed.has(path) || this.pending.has(path)) return;
    const button = this.resolve(path);
    if (!button || fileToggleAction(button) === 'Collapse file') {
      this.autoCollapsed.delete(path);
      return;
    }
    void this.transition(path, button, 'Collapse file', false);
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
    const confirmed = this.waitForAction(path, expected, controller.signal);
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
        const button = this.resolve(path);
        if (button && fileToggleAction(button) === expected) finish(true);
      };
      const abort = () => finish(false);
      const observer = new MutationObserver(check);
      observer.observe(locator.document.body, {
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
      item.hidden = !visible.has(item.id);
    }
  }
}
