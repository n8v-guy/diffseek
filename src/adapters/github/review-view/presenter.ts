import {
  type FilterState,
  matchesFacets,
  ReviewIndex,
} from '@diffseek/review';

import {
  diffRegionSelector,
  fileTreeItemSelector,
  fileTreeSelector,
  type PageSnapshot,
} from '../review-page/page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;
const styleId = 'diffseek-filter-style';

function filterStyles(
  snapshot: SupportedSnapshot,
  filters: FilterState,
  index: ReviewIndex,
): string {
  const shown = [...snapshot.unavailable.keys()];
  const hidden: string[] = [];
  const selectors: string[] = [];
  for (const file of snapshot.files) {
    if (snapshot.unavailable.has(file.path) || !snapshot.uniqueRegion(file.anchor) ||
      matchesFacets(file.labels, filters)) {
      shown.push(file.path);
    } else {
      hidden.push(file.path);
      selectors.push(`${diffRegionSelector}#${CSS.escape(file.anchor)}`);
    }
  }
  if (hidden.length === 0) return '';
  const visible = index.visibleItems(shown);
  for (const path of index.visibleItems(hidden)) {
    if (!visible.has(path)) {
      selectors.push(`${fileTreeSelector} ${fileTreeItemSelector}#${CSS.escape(path)}`);
    }
  }
  return `${selectors.join(',\n')} { display: none !important; }`;
}

export class ReviewPresenter {
  private readonly root: Document;

  constructor(root: Document) {
    this.root = root;
  }

  apply(
    snapshot: SupportedSnapshot,
    filters: FilterState,
    index = new ReviewIndex(snapshot.files),
  ): void {
    const css = filterStyles(snapshot, filters, index);
    const current = this.root.querySelector<HTMLStyleElement>(`style#${styleId}`);
    if (!css) {
      current?.remove();
    } else if (current) {
      if (current.textContent !== css) current.textContent = css;
    } else {
      const style = this.root.createElement('style');
      style.id = styleId;
      style.textContent = css;
      this.root.head.append(style);
    }
  }

  reset(): void {
    this.root.querySelector(`style#${styleId}`)?.remove();
  }
}
