import type { RepositoryCache } from '@diffseek/browser';
import {
  fileTreeElement,
  filterMenus,
  treeStructureKey,
} from '@diffseek/github';
import {
  pullMetadataPaths,
  unloadedMetadataPaths,
  type MetadataFiles,
  type RepositoryMetadata,
} from '@diffseek/repository-metadata';

import type { DefaultMetadata } from '../metadata/reader';

import type { QuietRevalidate } from './quiet-revalidate';

type MetadataRead = {
  readPull: (base: DefaultMetadata) => Promise<DefaultMetadata>;
  refreshDefault: () => Promise<DefaultMetadata>;
  commit: (cache: RepositoryCache) => Promise<boolean>;
  aborted: () => boolean;
  apply: (metadata: RepositoryMetadata) => void;
  onSettled?: () => void;
  onFinished?: (settled: boolean) => void;
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
  beginMetadataRefresh(
    state,
    () => replaceReviewMetadata(options),
    options.onSettled,
    options.onFinished,
  );
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
  onFinished?: (settled: boolean) => void,
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
      const ok = settled;
      if (ok) {
        state.settled = true;
        onSettled?.();
      }
      onFinished?.(ok);
    })
    .finally(() => {
      if (state.flight !== flight) return;
      state.flight = null;
      if (!state.pending || state.settled) return;
      state.pending = false;
      beginMetadataRefresh(state, start, onSettled, onFinished);
    });
  state.flight = flight;
}

export type TrackedMetadata = {
  requested: boolean;
  flight: boolean;
  defaultDue: boolean;
  pullDue: boolean;
  seenPaths: string;
  readPullPaths: Set<string>;
  files: MetadataFiles;
};

export function trackedMetadata(): TrackedMetadata {
  return {
    requested: false,
    flight: false,
    defaultDue: false,
    pullDue: false,
    seenPaths: '',
    readPullPaths: new Set(),
    files: {},
  };
}

function pathKey(paths: readonly string[]): string {
  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .join('\n');
}

/** Null when this tree was already considered. `stale` reopens the read. */
export function streamedMetadataStale(
  settled: boolean,
  state: TrackedMetadata,
  paths: readonly string[],
): { stale: boolean } | null {
  const key = pathKey(paths);
  if (!settled || key === state.seenPaths) return null;
  const pullPaths = pullMetadataPaths(paths);
  const stale =
    unloadedMetadataPaths(state.files, paths).length > 0 ||
    pullPaths.some((path) => !state.readPullPaths.has(path));
  if (!stale) state.seenPaths = key;
  return { stale };
}

async function readTrackedDefault(
  state: TrackedMetadata,
  read: (revalidate: boolean) => Promise<DefaultMetadata>,
): Promise<DefaultMetadata> {
  const revalidate = state.requested;
  state.requested = false;
  state.flight = revalidate;
  try {
    const result = await read(revalidate);
    state.files = result.cache.files;
    state.defaultDue = result.due === true;
    return result;
  } catch (error) {
    if (revalidate) state.defaultDue = true;
    throw error;
  }
}

async function readTrackedPull(
  state: TrackedMetadata,
  paths: readonly string[],
  revalidate: boolean,
  read: () => Promise<DefaultMetadata>,
): Promise<DefaultMetadata> {
  try {
    const result = await read();
    for (const path of pullMetadataPaths(paths)) state.readPullPaths.add(path);
    state.seenPaths = pathKey(paths);
    state.pullDue = result.due === true;
    return result;
  } catch (error) {
    if (revalidate) state.pullDue = true;
    throw error;
  }
}

type SessionMetadataLoad = {
  state: MetadataRefresh;
  tracked: TrackedMetadata;
  quiet: QuietRevalidate;
  paths: () => string[];
  readDefault: (revalidate: boolean) => Promise<DefaultMetadata>;
  readPull: (base: DefaultMetadata, revalidate: boolean) => Promise<DefaultMetadata>;
  commit: (cache: RepositoryCache) => Promise<boolean>;
  aborted: () => boolean;
  autoView: boolean;
  current: () => RepositoryMetadata;
  needsPass: () => boolean;
  schedule: () => void;
  store: (metadata: RepositoryMetadata) => void;
  /** A tree that arrived during this read still needs metadata. Clears settled. */
  reopen: () => boolean;
};

export function loadSessionMetadata(load: SessionMetadataLoad): void {
  loadReviewMetadata(load.state, {
    refreshDefault: () => readTrackedDefault(load.tracked, load.readDefault),
    readPull: (base) =>
      readTrackedPull(load.tracked, load.paths(), load.tracked.flight, () =>
        load.readPull(base, load.tracked.flight),
      ),
    commit: load.commit,
    aborted: load.aborted,
    onSettled: () => {
      if (load.autoView) load.schedule();
    },
    onFinished: () => {
      finishTrackedRead(load.tracked, load.quiet);
      if (load.reopen()) load.state.pending = true;
    },
    apply: (metadata) => {
      if (JSON.stringify(load.current()) === JSON.stringify(metadata)) return;
      load.store(metadata);
      if (load.needsPass()) load.schedule();
    },
  });
}

/** A failed reread stays due until the page changes. A pending reread is left to restart. */
function finishTrackedRead(
  state: TrackedMetadata,
  quiet: QuietRevalidate,
): void {
  const revalidated = state.flight;
  state.flight = false;
  const due = state.defaultDue || state.pullDue;
  if (revalidated) quiet.noteAttempt(due);
  else if (state.requested) return;
  else if (due) quiet.noteStale();
  else quiet.noteFresh();
}
