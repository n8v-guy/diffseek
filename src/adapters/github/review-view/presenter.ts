import {
  type FilterState,
  matchesFacets,
  ReviewIndex,
} from '@diffseek/review';

import type { PageSnapshot } from '../review-page/page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export class ReviewPresenter {
  /** Elements this session marked, including any later detached from the document. */
  private readonly marked = new Set<HTMLElement>();

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
      const hide = !matching.has(file.path);
      const treeItem = snapshot.treeItem(file.path);
      const region = snapshot.region(file.path);
      if (!hide) {
        if (treeItem) this.setFilteredOut(treeItem, false);
        if (region) this.setFilteredOut(region, false);
        continue;
      }
      if (!treeItem || !region) continue;
      this.setFilteredOut(treeItem, true);
      this.setFilteredOut(region, true);
    }

    this.updateFolders(snapshot, matching, index);
  }

  reset(root?: ParentNode | null): void {
    for (const element of this.marked) {
      delete element.dataset.diffseekFilteredOut;
    }
    this.marked.clear();
    for (const element of root?.querySelectorAll<HTMLElement>(
      '[data-diffseek-filtered-out]',
    ) ?? []) {
      delete element.dataset.diffseekFilteredOut;
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
      '[role="treeitem"][id]',
    ) ?? []) {
      if (!filePaths.has(item.id)) this.setFilteredOut(item, !visible.has(item.id));
    }
  }

  private setFilteredOut(element: HTMLElement, hide: boolean): void {
    if (!hide) {
      if (element.dataset.diffseekFilteredOut != null) {
        delete element.dataset.diffseekFilteredOut;
      }
      this.marked.delete(element);
      return;
    }
    if (element.dataset.diffseekFilteredOut !== 'true') {
      element.dataset.diffseekFilteredOut = 'true';
    }
    this.marked.add(element);
  }
}
