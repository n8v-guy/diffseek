import {
  fileTreeElement,
  treeStructureKey,
} from '@diffseek/github/review-page/page-adapter';
import { filterMenus } from '@diffseek/github/review-view/review-ui';
import type { RepositoryMetadata } from '@diffseek/repository-metadata';

export interface MetadataRefresh {
  flight: null | Promise<void>;
  pending: boolean;
  settled: boolean;
}

export interface MetadataWatch {
  menuOpen: boolean;
  ready: boolean;
  tree: Element | null;
  treeKey: null | string;
}

interface MetadataRead {
  aborted: () => boolean;
  apply: (metadata: RepositoryMetadata) => void;
  commit: (metadata: RepositoryMetadata) => Promise<boolean>;
  readPull: () => Promise<RepositoryMetadata>;
  refreshDefault: () => Promise<{
    changed: boolean;
    metadata: RepositoryMetadata;
  }>;
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
      (tree !== null && tree !== watch.tree) ||
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

export function metadataRefreshState(): MetadataRefresh {
  return { flight: null, pending: false, settled: false };
}

export function metadataWatch(): MetadataWatch {
  return { menuOpen: false, ready: false, tree: null, treeKey: null };
}

async function applyDefaultMetadata(
  options: MetadataRead,
  applied: { pull: boolean },
): Promise<void> {
  const result = await options.refreshDefault();
  if (options.aborted() || !result.changed) return;
  await commitDefault(options, result.metadata);
  if (!applied.pull && !options.aborted()) options.apply(result.metadata);
}

async function applyPullMetadata(
  options: MetadataRead,
  applied: { pull: boolean },
): Promise<void> {
  const metadata = await options.readPull();
  applied.pull = true;
  if (!options.aborted()) options.apply(metadata);
}

function beginMetadataRefresh(
  state: MetadataRefresh,
  start: () => Promise<boolean>,
): void {
  if (state.settled) return;
  if (state.flight !== null) {
    state.pending = true;
    return;
  }
  state.pending = false;
  state.flight = runMetadataFlight(state, start);
}

async function commitDefault(
  options: MetadataRead,
  metadata: RepositoryMetadata,
): Promise<void> {
  try {
    await options.commit(metadata);
  } catch {
    // The pull-head metadata still applies when the default-branch write fails.
  }
}

async function readDefaultMetadata(
  options: MetadataRead,
  applied: { pull: boolean },
): Promise<void> {
  try {
    await applyDefaultMetadata(options, applied);
  } catch {
    // A failed default refresh leaves the pull-head result in place.
  }
}

async function readPullMetadata(
  options: MetadataRead,
  applied: { pull: boolean },
): Promise<void> {
  try {
    await applyPullMetadata(options, applied);
  } catch {
    // The next tree or menu change can retry the pull-head read.
  }
}

async function rememberSettled(
  state: MetadataRefresh,
  start: () => Promise<boolean>,
): Promise<void> {
  let settled: boolean;
  try {
    settled = await start();
  } catch {
    settled = false;
  }
  if (settled) state.settled = true;
}

async function replaceReviewMetadata(options: MetadataRead): Promise<boolean> {
  const applied = { pull: false };
  await Promise.all([
    readPullMetadata(options, applied),
    readDefaultMetadata(options, applied),
  ]);
  return applied.pull && !options.aborted();
}

async function runMetadataFlight(
  state: MetadataRefresh,
  start: () => Promise<boolean>,
): Promise<void> {
  try {
    await rememberSettled(state, start);
  } finally {
    state.flight = null;
    if (state.pending && !state.settled) {
      state.pending = false;
      beginMetadataRefresh(state, start);
    }
  }
}
