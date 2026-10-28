import {
  fileTreeElement,
  treeStructureKey,
} from '@diffseek/github/review-page/page-adapter';
import { filterMenus } from '@diffseek/github/review-view/review-ui';
import type { RepositoryMetadata } from '@diffseek/repository-metadata';

type MetadataRead = {
  readPull: () => Promise<RepositoryMetadata>;
  refreshDefault: () => Promise<{
    metadata: RepositoryMetadata;
    changed: boolean;
  }>;
  commit: (metadata: RepositoryMetadata) => Promise<boolean>;
  aborted: () => boolean;
  apply: (metadata: RepositoryMetadata) => void;
};

export type MetadataWatch = {
  ready: boolean;
  treeKey: string | null;
  tree: Element | null;
  menuOpen: boolean;
};

export type MetadataRefresh = {
  settled: boolean;
  flight: Promise<void> | null;
  pending: boolean;
};

export function metadataWatch(): MetadataWatch {
  return { ready: false, treeKey: null, tree: null, menuOpen: false };
}

export function metadataRefreshState(): MetadataRefresh {
  return { settled: false, flight: null, pending: false };
}

/** First observation records the baseline and does not count as a retry. */
export function consumeMetadataOpportunity(
  watch: MetadataWatch,
  root: Document,
): boolean {
  const treeKey = treeStructureKey(root);
  const tree = fileTreeElement(root);
  const menuOpen = filterMenus(root).length > 0;
  const changed =
    watch.ready &&
    (treeKey !== watch.treeKey ||
      (tree != null && tree !== watch.tree) ||
      (menuOpen && !watch.menuOpen));
  watch.ready = true;
  watch.treeKey = treeKey;
  watch.tree = tree;
  watch.menuOpen = menuOpen;
  return changed;
}

export function loadReviewMetadata(
  state: MetadataRefresh,
  options: MetadataRead,
): void {
  beginMetadataRefresh(state, () => replaceReviewMetadata(options));
}

async function replaceReviewMetadata(options: MetadataRead): Promise<boolean> {
  let pullApplied = false;
  await Promise.all([
    options
      .readPull()
      .then((metadata) => {
        pullApplied = true;
        if (!options.aborted()) options.apply(metadata);
      })
      .catch(() => undefined),
    options
      .refreshDefault()
      .then(async (result) => {
        if (options.aborted() || !result.changed) return;
        await options.commit(result.metadata).catch(() => false);
        if (!pullApplied && !options.aborted()) options.apply(result.metadata);
      })
      .catch(() => undefined),
  ]);
  return pullApplied && !options.aborted();
}

function beginMetadataRefresh(
  state: MetadataRefresh,
  start: () => Promise<boolean>,
): void {
  if (state.settled) return;
  if (state.flight) {
    state.pending = true;
    return;
  }
  state.pending = false;
  const flight = start()
    .catch(() => false)
    .then((settled) => {
      if (settled) state.settled = true;
    })
    .finally(() => {
      if (state.flight !== flight) return;
      state.flight = null;
      if (!state.pending || state.settled) return;
      state.pending = false;
      beginMetadataRefresh(state, start);
    });
  state.flight = flight;
}
