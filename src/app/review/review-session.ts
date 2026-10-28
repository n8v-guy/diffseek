import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import {
  bindSnapshot,
  refreshObservedFiles,
  regionStructureKey,
  scanPage,
  treeStructureKey,
  type PageSnapshot,
} from '@diffseek/github/review-page/page-adapter';
import {
  type markViewed,
  mountViewedActions,
} from '@diffseek/github/review-page/viewed-actions';
import { mountFilterMenu } from '@diffseek/github/review-view/filter-menu';
import { ReviewPresenter } from '@diffseek/github/review-view/presenter';
import {
  afterNextPaint,
  filterMenus,
  menuNeedsRemount,
  removeInjected,
  removeUnavailable,
  showAlwaysRead,
  showBatchResult,
  showBatchStarted,
  showRememberedFilterDefault,
  showUnavailable,
} from '@diffseek/github/review-view/review-ui';
import type { ReviewRef } from '@diffseek/github/routing/page-route';
import {
  type MetadataCommitGuard,
  type RepositoryMetadata,
  type RepositoryRef,
} from '@diffseek/repository-metadata';
import {
  emptyFacetExclusions,
  excludedFacetCount,
  FileCatalog,
  ReviewIndex,
} from '@diffseek/review';

import { ViewedActionExecutor } from './action-executor';
import {
  consumeMetadataOpportunity,
  loadReviewMetadata,
  metadataRefreshState,
  metadataWatch,
} from './metadata-refresh';
import {
  installRedrawTrace,
  noteReconcile,
  trackDiffseekWrites,
} from './redraw-trace';
import {
  cancelPanelReconcile,
  classifyKeyFor,
  classifySnapshot,
  filteredFileExpanded,
  pageNodesChanged,
  type PanelReconcileSchedule,
  type PanelScheduleOptions,
  pendingDefaultViewed,
  projectionKeyFor,
  queuePanelReconcile,
  refreshViewedState,
  retainNativeOwners,
  scheduleForMutations,
  syncViewedLabels,
  watchObservationRoots,
} from './session-observation';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export type ReviewSessionOptions = {
  root: Document;
  review: ReviewRef;
  metadata: RepositoryMetadata;
  metadataCommits: MetadataCommitGuard;
  refreshDefault: (
    repository: RepositoryRef,
  ) => Promise<{ metadata: RepositoryMetadata; changed: boolean }>;
  readPull: (
    review: ReviewRef,
    fallback: RepositoryMetadata,
  ) => Promise<RepositoryMetadata>;
  markFiles: typeof markViewed;
  filterDefaults: FilterDefaults;
  writeFilterDefaults: (defaults: FilterDefaults) => Promise<void>;
};

export class ReviewSession {
  private readonly lifecycle = new AbortController();
  private readonly catalog = new FileCatalog();
  private readonly presenter = new ReviewPresenter();
  private readonly filters = emptyFacetExclusions();
  private readonly observedOwners = new Map<string, string[]>();
  private readonly defaultViewedAttempts = new Set<string>();
  private readonly metadataRevision: number;
  private readonly actionExecutor: ViewedActionExecutor;
  private readonly observer: MutationObserver;
  private readonly discoveryObserver: MutationObserver;
  private readonly observedRoots = new Set<Element>();
  private readonly onNativeClick: (event: MouseEvent) => void;
  private snapshot: SupportedSnapshot | null = null;
  private readonly scheduleState: PanelReconcileSchedule = {
    timer: null,
    delayMs: 0,
    scheduled: false,
  };
  private reconciling = false;
  private dirty = false;
  private defaultViewedInFlight = 0;
  private readonly metadataWatch = metadataWatch();
  private readonly metadataRefresh = metadataRefreshState();
  private projectionFingerprint = '';
  private treeKey: string | null = null;
  private regionKey = '';
  private treeNode: Element | null = null;
  private regionNodes: Element[] = [];
  private classifyKey = '';
  private unavailable = new Map<string, string>();
  private metadata: RepositoryMetadata;

  constructor(private readonly options: ReviewSessionOptions) {
    for (const facet of options.filterDefaults.hidden) {
      this.filters.get(facet)?.add('true');
    }
    this.metadata = options.metadata;
    this.metadataRevision = options.metadataCommits.begin(options.review);
    this.actionExecutor = new ViewedActionExecutor({
      current: () =>
        this.snapshot
          ? {
              reviewKey: options.review.key,
              generation: this.metadataRevision,
              snapshot: this.snapshot,
            }
          : null,
      beforeExecute: () => afterNextPaint(options.root),
      markFiles: options.markFiles,
    });
    this.onNativeClick = (event) => {
      const ElementType = options.root.defaultView?.Element;
      const ButtonType = options.root.defaultView?.HTMLButtonElement;
      if (!event.isTrusted || !ElementType || !(event.target instanceof ElementType)) {
        return;
      }
      const button = event.target.closest('button');
      if (!ButtonType || !(button instanceof ButtonType)) return;
      const path = this.snapshot?.files.find(
        (file) => this.snapshot?.viewedControl(file.path) === button,
      )?.path;
      if (path) this.actionExecutor.invalidate(path);
    };
    options.root.addEventListener('click', this.onNativeClick, true);
    installRedrawTrace(options.root);
    delete options.root.documentElement.dataset.diffseekFirstRenderEpoch;
    this.observer = new MutationObserver((records) => {
      const mode = scheduleForMutations(records);
      if (mode) this.schedule(mode);
    });
    this.discoveryObserver = new MutationObserver((records) => {
      const mode = scheduleForMutations(records);
      if (!mode) return;
      this.refreshObservationRoots();
      this.schedule(mode);
    });
    this.discoveryObserver.observe(options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  start(): void { this.reconcile(); void this.refreshMetadata(); }

  reconcile(): void {
    if (this.lifecycle.signal.aborted || this.reconciling) {
      this.dirty = true;
      return;
    }
    this.reconciling = true;
    this.scheduleState.scheduled = false;
    try {
      do {
        this.dirty = false;
        this.reconcileOnce();
      } while (this.dirty && !this.lifecycle.signal.aborted);
    } finally {
      this.reconciling = false;
    }
  }

  stop(): void {
    if (this.lifecycle.signal.aborted) return;
    this.lifecycle.abort();
    this.options.metadataCommits.invalidate(this.options.review);
    this.actionExecutor.cancel();
    this.options.root.removeEventListener('click', this.onNativeClick, true);
    this.observer.disconnect();
    this.discoveryObserver.disconnect();
    this.observedRoots.clear();
    cancelPanelReconcile(this.scheduleState, this.options.root.defaultView);
    this.clearInjected();
  }

  private reconcileOnce(): void {
    if (consumeMetadataOpportunity(this.metadataWatch, this.options.root)) this.refreshMetadata();
    // Disconnect while writing so our own hidden/dataset toggles do not
    // immediately re-schedule another full reconcile during panel storms.
    this.observer.disconnect();
    this.discoveryObserver.disconnect();
    this.observedRoots.clear();
    const root = this.options.root;
    const treeKey = treeStructureKey(root);
    const regionKey = regionStructureKey(root);
    const tree = root.querySelector('[role="tree"][aria-label="File Tree"]');
    const regions = [...root.querySelectorAll<HTMLElement>('[role="region"][id^="diff-"]')];
    const structureChanged =
      treeKey !== this.treeKey ||
      regionKey !== this.regionKey ||
      pageNodesChanged(this.treeNode, tree, this.regionNodes, regions);
    let next: PageSnapshot;
    if (treeKey != null && treeKey === this.treeKey && regionKey === this.regionKey && this.snapshot) {
      refreshObservedFiles(root, this.catalog.files());
      next = bindSnapshot(root, this.catalog.files(), this.unavailable);
    } else {
      next = scanPage(root);
      if (treeKey !== this.treeKey) this.classifyKey = '';
      this.treeKey = treeKey;
      this.regionKey = regionKey;
    }
    this.treeNode = tree;
    this.regionNodes = regions;
    if (!next.supported) {
      this.projectionFingerprint = '';
      this.treeKey = null;
      this.regionKey = '';
      this.classifyKey = '';
      this.treeNode = null;
      this.regionNodes = [];
      this.clearInjected();
      if (excludedFacetCount(this.filters) > 0) {
        showUnavailable(root, next.reason);
      }
      this.reattachObservers();
      this.emitReconciled();
      return;
    }

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
    const defaultViewedPaths = pendingDefaultViewed(catalogSnapshot.files, this.options.filterDefaults, this.defaultViewedAttempts);
    const generatedDefaultBusy =
      this.defaultViewedInFlight > 0 || defaultViewedPaths.length > 0;
    const menus = filterMenus(this.options.root);
    const fingerprint = projectionKeyFor({
      metadataRevision: this.metadataRevision,
      metadata: this.metadata,
      filters: this.filters,
      filterDefaults: this.options.filterDefaults,
      generatedDefaultBusy,
      menuCount: menus.length,
      files: catalogSnapshot.files,
    });
    const projectionChanged = fingerprint !== this.projectionFingerprint;
    const staleMenus = menus.filter(menuNeedsRemount);
    if (!structureChanged && !projectionChanged && staleMenus.length === 0) {
      // GitHub expanding a filtered file changes neither key. Re-collapse it.
      if (filteredFileExpanded(root)) {
        this.presenter.apply(catalogSnapshot, this.filters);
      }
      this.reattachObservers();
      return;
    }
    trackDiffseekWrites(root, () => {
      if (structureChanged || projectionChanged) {
        const index = new ReviewIndex(catalogSnapshot.files);
        this.presenter.apply(catalogSnapshot, this.filters, index);
        mountViewedActions(
          catalogSnapshot,
          (viewed, paths) => this.batch(viewed, paths),
          index,
          this.filters,
        );
      }
      if (projectionChanged) {
        this.projectionFingerprint = fingerprint;
        if (defaultViewedPaths.length > 0) {
          this.enqueueDefaultViewed(defaultViewedPaths);
        }
      }
      for (const menu of projectionChanged ? menus : staleMenus) {
        this.mountMenu(menu, catalogSnapshot, generatedDefaultBusy);
      }
    });
    this.reattachObservers();
    this.emitReconciled();
  }

  private reattachObservers(): void {
    this.discoveryObserver.observe(this.options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  private schedule(options: PanelScheduleOptions = {}): void {
    if (this.lifecycle.signal.aborted || this.defaultViewedInFlight > 0) return;
    if (this.reconciling) {
      this.dirty = true;
      return;
    }
    queuePanelReconcile(
      this.scheduleState,
      this.options.root,
      options,
      () => this.reconcile(),
    );
  }

  private batch(viewed: boolean, paths: string[]): void {
    if (!this.snapshot) return;
    showBatchStarted(this.options.root, viewed, paths.length);
    void this.actionExecutor
      .enqueue({
        reviewKey: this.options.review.key,
        generation: this.metadataRevision,
        viewed,
        paths,
      })
      .then((result) => {
        if (!result || this.lifecycle.signal.aborted) return;
        showBatchResult(this.options.root, result, viewed);
        this.schedule();
      });
  }

  private rememberFilterDefault(
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ): void {
    showRememberedFilterDefault(this.options.root, facet, state);
    void this.options.writeFilterDefaults(this.options.filterDefaults);
  }

  private enqueueDefaultViewed(paths: string[]): void {
    for (const path of paths) this.defaultViewedAttempts.add(path);
    this.defaultViewedInFlight += 1;
    showBatchStarted(this.options.root, true, paths.length);
    void this.actionExecutor
      .enqueue({
        reviewKey: this.options.review.key,
        generation: this.metadataRevision,
        viewed: true,
        paths,
      })
      .catch(() => null)
      .then((result) => {
        this.defaultViewedInFlight = Math.max(0, this.defaultViewedInFlight - 1);
        if (this.lifecycle.signal.aborted) return;
        if (result) showBatchResult(this.options.root, result, true);
        this.reconcile();
      });
  }

  private mountMenu(
    menu: HTMLElement,
    snapshot: SupportedSnapshot,
    generatedDefaultBusy: boolean,
  ): void {
    mountFilterMenu(menu, {
      files: snapshot.files,
      filters: this.filters,
      filterDefaults: this.options.filterDefaults,
      generatedDefaultBusy,
      onChange: () => this.reconcile(),
      onFilterDefaultChange: (facet, state) =>
        this.rememberFilterDefault(facet, state),
      onAlwaysReadChange: (enabled) => {
        if (!enabled) this.defaultViewedAttempts.clear();
        showAlwaysRead(this.options.root, enabled);
        void this.options.writeFilterDefaults(this.options.filterDefaults);
      },
      onViewed: (viewed, paths) => this.batch(viewed, paths),
    });
  }

  private refreshMetadata(): void {
    loadReviewMetadata(this.metadataRefresh, {
      readPull: () => this.options.readPull(this.options.review, this.metadata),
      refreshDefault: () => this.options.refreshDefault(this.options.review),
      commit: (metadata) => this.options.metadataCommits.commit(this.options.review, this.metadataRevision, metadata),
      aborted: () => this.lifecycle.signal.aborted,
      apply: (metadata) => {
        if (JSON.stringify(this.metadata) === JSON.stringify(metadata)) return;
        this.metadata = metadata; this.classifyKey = ''; this.reconcile();
      },
    });
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

  private refreshObservationRoots(): void {
    watchObservationRoots({
      root: this.options.root,
      observer: this.observer,
      observedRoots: this.observedRoots,
    });
  }

  private clearInjected(): void {
    this.presenter.reset(this.snapshot);
    this.snapshot = null;
    removeInjected(this.options.root);
  }

  private emitReconciled(): void {
    noteReconcile(this.options.root);
    this.options.root.dispatchEvent(new CustomEvent('diffseek-reconciled'));
  }
}
