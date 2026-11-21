import {
  type FilterState,
  matchesFacets,
  ReviewIndex,
} from '@diffseek/review';

import type { PageSnapshot } from '../review-page/page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export class ReviewPresenter {
  /** Rows this session hid, so teardown shows only those again. */
  private readonly hiddenRows = new Set<HTMLElement>();

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
      const hide = !matching.has(file.path);
      this.setHidden(treeItem, hide);
      if (!hide) {
        if (region.dataset.diffseekFilteredOut != null) {
          delete region.dataset.diffseekFilteredOut;
        }
      } else if (region.dataset.diffseekFilteredOut !== 'true') {
        region.dataset.diffseekFilteredOut = 'true';
      }
    }

    this.updateFolders(snapshot, matching, index);
  }

  reset(snapshot?: SupportedSnapshot | null): void {
    for (const file of snapshot?.files ?? []) {
      delete snapshot?.region(file.path)?.dataset.diffseekFilteredOut;
    }
    for (const row of this.hiddenRows) row.hidden = false;
    this.hiddenRows.clear();
  }

  private setHidden(row: HTMLElement, hide: boolean): void {
    if (row.hidden !== hide) row.hidden = hide;
    if (hide) this.hiddenRows.add(row);
    else this.hiddenRows.delete(row);
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
      if (!filePaths.has(item.id)) this.setHidden(item, !visible.has(item.id));
    }
  }
}
