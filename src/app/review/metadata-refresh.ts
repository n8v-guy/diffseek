import type { RepositoryCache } from '@diffseek/browser';
import {
  fileTreeElement,
  filterMenus,
  treeStructureKey,
} from '@diffseek/github';
import type { RepositoryMetadata } from '@diffseek/repository-metadata';

import type { DefaultMetadata } from '../metadata/reader';

type MetadataRead = {
  readPull: (base: DefaultMetadata) => Promise<DefaultMetadata>;
  refreshDefault: () => Promise<DefaultMetadata>;
  commit: (cache: RepositoryCache) => Promise<boolean>;
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
  beginMetadataRefresh(state, () => replaceReviewMetadata(options), options.onSettled);
}

async function replaceReviewMetadata(options: MetadataRead): Promise<boolean> {
  try {
    const base = await options.refreshDefault();
    if (options.aborted()) return false;
    options.apply(base.metadata);
    if (base.changed) await options.commit(base.cache).catch(() => false);
    const pulled = await options.readPull(base);
    if (options.aborted()) return false;
    options.apply(pulled.metadata);
    if (pulled.changed) await options.commit(pulled.cache).catch(() => false);
    return true;
  } catch (error) {
    reportReadFailure(error);
    return false;
  }
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
  const flight = start()
    .catch(() => false)
    .then((settled) => {
      if (settled) {
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
