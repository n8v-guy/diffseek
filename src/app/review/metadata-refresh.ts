import {
  fileTreeElement,
  filterMenus,
  treeStructureKey,
} from '@diffseek/github';
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
  onSettled?: () => void;
};

export type MetadataWatch = {
  ready: boolean;
  treeKey: string | null;
  tree: Element | null;
  menuOpen: boolean;
};

export type MetadataRefresh = {
  key: string;
  settled: boolean;
  flight: Promise<void> | null;
  pending: boolean;
};

export function metadataWatch(): MetadataWatch {
  return { ready: false, treeKey: null, tree: null, menuOpen: false };
}

export function metadataRefreshState(): MetadataRefresh {
  return { key: '', settled: false, flight: null, pending: false };
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
  key = '',
): void {
  if (state.key !== key) {
    state.key = key;
    state.settled = false;
  }
  beginMetadataRefresh(state, () => {
    const current = state.key;
    return replaceReviewMetadata({
      ...options,
      aborted: () => options.aborted() || state.key !== current,
    });
  }, options.onSettled);
}

async function replaceReviewMetadata(options: MetadataRead): Promise<boolean> {
  const applied = { pull: false };
  await Promise.all([
    options
      .readPull()
      .then((metadata) => {
        applied.pull = true;
        if (!options.aborted()) options.apply(metadata);
      })
      .catch(reportReadFailure),
    options
      .refreshDefault()
      .then(async (result) => {
        if (options.aborted() || !result.changed) return;
        await options.commit(result.metadata).catch(() => false);
        if (!applied.pull && !options.aborted()) options.apply(result.metadata);
      })
      .catch(reportReadFailure),
  ]);
  return applied.pull && !options.aborted();
}

/** The review keeps going; developers and tests still see the failed read. */
function reportReadFailure(error: unknown): void {
  console.error(error);
}

function beginMetadataRefresh(
  state: MetadataRefresh,
  start: () => Promise<boolean>,
  onSettled?: () => void,
): void {
  if (state.settled) return;
  if (state.flight) {
    state.pending = true;
    return;
  }
  state.pending = false;
  const key = state.key;
  const flight = start()
    .catch(() => false)
    .then((settled) => {
      if (settled && state.key === key) {
        state.settled = true;
        onSettled?.();
      }
    })
    .finally(() => {
      if (state.flight !== flight) return;
      state.flight = null;
      if (!state.pending || state.settled) return;
      state.pending = false;
      beginMetadataRefresh(state, start, onSettled);
    });
  state.flight = flight;
}
