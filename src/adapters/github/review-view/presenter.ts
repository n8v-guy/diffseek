import {
  type FilterState,
  matchesFacets,
  ReviewIndex,
} from '@diffseek/review';

import type { PageSnapshot } from '../review-page/page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

/**
 * Clicks the first shown file in the tree, as a reviewer would, so GitHub
 * scrolls its diff into view. Skipped when that diff is already on screen.
 */
export function revealFirstShown(snapshot: SupportedSnapshot): void {
  const paths = new Set(snapshot.files.map((file) => file.path));
  const item = snapshot
    .treeItems()
    .find((candidate) => candidate.hidden === false && paths.has(candidate.id));
  if (item == null) return;
  const region = snapshot.region(item.id);
  if (region != null && onScreen(region)) return;
  [...item.querySelectorAll<HTMLAnchorElement>('a[href^="#diff-"]')]
    .find((link) => link.closest('[role="treeitem"]') === item)
    ?.click();
}

function onScreen(region: HTMLElement): boolean {
  const height = region.ownerDocument.defaultView?.innerHeight ?? 0;
  const { top, bottom } = region.getBoundingClientRect();
  return bottom > 0 && top < height;
}

export class ReviewPresenter {
  /** Rows this session hid, so teardown shows only those again. */
  private readonly hiddenRows = new Set<HTMLElement>();
  private shown: Set<string> | null = null;
  private filterKey = '';

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
    this.revealIfNarrowed(snapshot, filters, matching);
  }

  /**
   * Only the reviewer changes filters, so a changed filter that hides a shown
   * file is their narrowing. Page loads and auto-view keep the filters as is.
   */
  private revealIfNarrowed(
    snapshot: SupportedSnapshot,
    filters: FilterState,
    matching: Set<string>,
  ): void {
    const key = [...filters].map(([facet, values]) => {
      const sorted = [...values].sort((left, right) => left.localeCompare(right));
      return `${facet}:${sorted.join(',')}`;
    }).join('|');
    const narrowed =
      key !== this.filterKey &&
      [...(this.shown ?? [])].some((path) => !matching.has(path));
    this.shown = matching;
    this.filterKey = key;
    // After this pass's writes, so GitHub's response to the click is observed.
    if (narrowed) queueMicrotask(() => revealFirstShown(snapshot));
  }

  reset(snapshot?: SupportedSnapshot | null): void {
    for (const file of snapshot?.files ?? []) {
      delete snapshot?.region(file.path)?.dataset.diffseekFilteredOut;
    }
    for (const row of this.hiddenRows) row.hidden = false;
    this.hiddenRows.clear();
    this.shown = null;
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
