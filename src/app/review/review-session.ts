import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import type { markViewed } from '@diffseek/github/review-page/viewed-actions';
import type { ReviewRef } from '@diffseek/github/routing/page-route';
import type { MetadataCommitGuard, RepositoryMetadata, RepositoryRef } from '@diffseek/repository-metadata';

import {
  bindSnapshot,
  fileTreeElement,
  type PageSnapshot,
  refreshObservedFiles,
  regionStructureKey,
  scanPage,
  treeStructureKey,
} from '@diffseek/github/review-page/page-adapter';
import { removeUnavailable } from '@diffseek/github/review-view/review-ui';
import { FileCatalog } from '@diffseek/review';

import {
  consumeMetadataOpportunity,
  loadReviewMetadata,
  metadataRefreshState,
  metadataWatch,
} from './metadata-refresh';
import { installRedrawTrace, noteReconcile } from './redraw-trace';
import {
  classifyKeyFor,
  classifySnapshot,
  refreshViewedState,
  retainNativeOwners,
  syncViewedLabels,
} from './review-session-pass';
import {
  cancelPanelReconcile,
  freshPanelSchedule,
  type PageNodes,
  pageNodesChanged,
  type PanelReconcileSchedule,
  type PanelScheduleOptions,
  queuePanelReconcile,
  scheduleForMutations,
  watchObservationRoots,
} from './session-observation';
import { SessionProjection } from './session-projection';

export interface ReviewSessionOptions {
  filterDefaults: FilterDefaults;
  markFiles: typeof markViewed;
  metadata: RepositoryMetadata;
  metadataCommits: MetadataCommitGuard;
  readPull: (
    review: ReviewRef,
    fallback: RepositoryMetadata,
  ) => Promise<RepositoryMetadata>;
  refreshDefault: (
    repository: RepositoryRef,
  ) => Promise<{ changed: boolean; metadata: RepositoryMetadata; }>;
  review: ReviewRef;
  root: Document;
  writeFilterDefaults: (defaults: FilterDefaults) => Promise<void>;
}

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

type UnsupportedSnapshot = Extract<PageSnapshot, { supported: false }>;

const diffRegionSelector = '[role="region"][id^="diff-"]';

export class ReviewSession {
  private readonly catalog = new FileCatalog();
  private classifyKey = '';
  private dirty = false;
  private readonly discoveryObserver: MutationObserver;
  private readonly lifecycle = new AbortController();
  private metadata: RepositoryMetadata;
  private readonly metadataRefresh = metadataRefreshState();
  private readonly metadataRevision: number;
  private readonly metadataWatch = metadataWatch();
  private readonly observedOwners = new Map<string, string[]>();
  private readonly observedRoots = new Set<Element>();
  private readonly observer: MutationObserver;
  private readonly options: ReviewSessionOptions;
  private pageNodes: PageNodes = { regions: [], tree: null };
  private readonly projection: SessionProjection;
  private reconciling = false;
  private regionKey = '';
  private readonly scheduleState: PanelReconcileSchedule;
  private snapshot: null | SupportedSnapshot = null;
  private treeKey: null | string = null;
  private unavailable = new Map<string, string>();

  constructor(options: ReviewSessionOptions) {
    this.options = options;
    this.metadata = options.metadata;
    this.metadataRevision = options.metadataCommits.begin(options.review);
    this.projection = new SessionProjection({
      ...options,
      aborted: (): boolean => this.lifecycle.signal.aborted,
      metadataRevision: this.metadataRevision,
      reconcile: (): void => {
        this.reconcile();
      },
      schedule: (): void => {
        this.schedule();
      },
      snapshot: (): null | SupportedSnapshot => this.snapshot,
    });
    installRedrawTrace(options.root);
    delete options.root.documentElement.dataset['diffseekFirstRenderEpoch'];
    this.scheduleState = freshPanelSchedule(options.root, (): void => {
      this.reconcile();
    });
    this.observer = new MutationObserver((records): void => {
      const mode = scheduleForMutations(records);
      if (mode) this.schedule(mode);
    });
    this.discoveryObserver = new MutationObserver((records): void => {
      const mode = scheduleForMutations(records);
      if (!mode) return;
      this.refreshObservationRoots();
      this.schedule(mode);
    });
    this.reattachObservers();
  }

  reconcile(): void {
    if (this.lifecycle.signal.aborted || this.reconciling) {
      this.dirty = true;
      return;
    }
    this.reconciling = true;
    // This pass reads the whole page, so a queued pass has nothing left to do.
    cancelPanelReconcile(this.scheduleState);
    try {
      this.reconcilePasses();
    } finally {
      this.reconciling = false;
    }
  }

  start(): void {
    this.reconcile();
    this.refreshMetadata();
  }

  stop(): void {
    if (this.lifecycle.signal.aborted) return;
    this.lifecycle.abort();
    this.options.metadataCommits.invalidate(this.options.review);
    this.projection.stop();
    this.detachObservers();
    cancelPanelReconcile(this.scheduleState);
    this.clearInjected();
  }

  private abandonPage(next: UnsupportedSnapshot): void {
    this.treeKey = null;
    this.regionKey = '';
    this.classifyKey = '';
    this.pageNodes = { regions: [], tree: null };
    this.clearInjected();
    this.projection.reportUnavailable(next.reason);
    this.reattachObservers();
    this.emitReconciled();
  }

  private adoptSnapshot(next: SupportedSnapshot): SupportedSnapshot {
    retainNativeOwners(next, this.observedOwners);
    this.catalog.merge(next.files);
    refreshViewedState(next, this.catalog.files());
    this.unavailable = next.unavailable;
    const catalogSnapshot: SupportedSnapshot = {
      ...next,
      files: this.catalog.files(),
    };
    this.snapshot = catalogSnapshot;
    removeUnavailable(this.options.root);
    this.classifyIfNeeded(catalogSnapshot);
    return catalogSnapshot;
  }

  private applySupported(next: SupportedSnapshot, structureChanged: boolean): void {
    const catalogSnapshot = this.adoptSnapshot(next);
    const rendered = this.projection.apply(catalogSnapshot, structureChanged, this.metadata);
    this.reattachObservers();
    if (rendered) this.emitReconciled();
  }

  private capturePage(): { next: PageSnapshot; structureChanged: boolean } {
    const root = this.options.root;
    const treeKey = treeStructureKey(root);
    const regionKey = regionStructureKey(root);
    const nodes = {
      regions: [...root.querySelectorAll<HTMLElement>(diffRegionSelector)],
      tree: fileTreeElement(root),
    };
    const structureChanged =
      treeKey !== this.treeKey ||
      regionKey !== this.regionKey ||
      pageNodesChanged(this.pageNodes, nodes);
    const next = this.snapshotFor(root, treeKey, regionKey);
    this.pageNodes = nodes;
    return { next, structureChanged };
  }

  private classifyIfNeeded(snapshot: SupportedSnapshot): void {
    const nextKey = classifyKeyFor(this.metadata, snapshot.files);
    if (nextKey === this.classifyKey) {
      syncViewedLabels(snapshot.files);
      return;
    }
    classifySnapshot(snapshot, this.metadata);
    this.classifyKey = nextKey;
  }

  private clearInjected(): void {
    this.projection.clear(this.snapshot);
    this.snapshot = null;
  }

  private continueReconcile(): boolean {
    return this.dirty && !this.lifecycle.signal.aborted;
  }

  private detachObservers(): void {
    this.observer.disconnect();
    this.discoveryObserver.disconnect();
    this.observedRoots.clear();
  }

  private emitReconciled(): void {
    noteReconcile(this.options.root);
    this.options.root.dispatchEvent(new CustomEvent('diffseek-reconciled'));
  }

  private reattachObservers(): void {
    this.discoveryObserver.observe(this.options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  private reconcileOnce(): void {
    if (consumeMetadataOpportunity(this.metadataWatch, this.options.root)) {
      this.refreshMetadata();
    }
    this.detachObservers();
    const page = this.capturePage();
    if (!page.next.supported) {
      this.abandonPage(page.next);
      return;
    }
    this.applySupported(page.next, page.structureChanged);
  }

  private reconcilePasses(): void {
    do {
      this.dirty = false;
      this.reconcileOnce();
    } while (this.continueReconcile());
  }

  private refreshMetadata(): void {
    loadReviewMetadata(this.metadataRefresh, {
      aborted: (): boolean => this.lifecycle.signal.aborted,
      apply: (metadata): void => {
        if (JSON.stringify(this.metadata) === JSON.stringify(metadata)) return;
        this.metadata = metadata;
        this.classifyKey = '';
        this.reconcile();
      },
      commit: (metadata): Promise<boolean> =>
        this.options.metadataCommits.commit(
          this.options.review,
          this.metadataRevision,
          metadata,
        ),
      readPull: (): Promise<RepositoryMetadata> =>
        this.options.readPull(this.options.review, this.metadata),
      refreshDefault: (): Promise<{ changed: boolean; metadata: RepositoryMetadata }> =>
        this.options.refreshDefault(this.options.review),
    });
  }

  private refreshObservationRoots(): void {
    watchObservationRoots({
      observedRoots: this.observedRoots,
      observer: this.observer,
      root: this.options.root,
    });
  }

  private schedule(options: PanelScheduleOptions = {}): void {
    if (this.lifecycle.signal.aborted || this.projection.defaultViewedBusy()) return;
    if (this.reconciling) {
      this.dirty = true;
      return;
    }
    queuePanelReconcile(this.scheduleState, options);
  }

  private snapshotFor(
    root: Document,
    treeKey: null | string,
    regionKey: string,
  ): PageSnapshot {
    if (
      treeKey !== null &&
      treeKey === this.treeKey &&
      regionKey === this.regionKey &&
      this.snapshot !== null
    ) {
      refreshObservedFiles(root, this.catalog.files());
      return bindSnapshot(root, { files: this.catalog.files(), unavailable: this.unavailable });
    }
    if (treeKey !== this.treeKey) this.classifyKey = '';
    this.treeKey = treeKey;
    this.regionKey = regionKey;
    return scanPage(root);
  }

}
