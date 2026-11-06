import type {
  FilterDefaultState,
  FilterDefaults,
  RepositoryCache,
} from '@diffseek/browser';
import {
  afterNextPaint,
  bindSnapshot,
  dismissSnackbar,
  filterMenus,
  menuNeedsRemount,
  mountFilterMenu,
  mountViewedActions,
  refreshObservedFiles,
  regionStructureKey,
  removeInjected,
  removeUnavailable,
  ReviewPresenter,
  scanPage,
  showAlwaysRead,
  showBatchResult,
  showBatchStarted,
  showRememberedFilterDefault,
  showUnavailable,
  treeStructureKey,
  type markViewed,
  type PageSnapshot,
  type ReviewRef,
  type ViewedTarget,
} from '@diffseek/github';
import type {
  MetadataCommitGuard,
  RepositoryMetadata,
} from '@diffseek/repository-metadata';
import {
  changedSurfaces,
  emptyFacetExclusions,
  excludedFacetCount,
  FileCatalog,
  planView,
  ReviewIndex,
  type ViewPlan,
} from '@diffseek/review';

import type { DefaultMetadata } from '../metadata/reader';

import { ViewedActionExecutor } from './action-executor';
import {
  consumeMetadataOpportunity,
  loadSessionMetadata,
  metadataRefreshState,
  metadataWatch,
  streamedMetadataStale,
  trackedMetadata,
  type TrackedMetadata,
} from './metadata-refresh';
import {
  sessionQuiet,
  type QuietClock,
  type QuietRevalidate,
} from './quiet-revalidate';
import {
  installRedrawTrace,
  noteReconcile,
  noteReconcileEntry,
  noteReconcileNoop,
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
  metadataCommits: MetadataCommitGuard<RepositoryCache>;
  refreshDefault: (
    review: ReviewRef & { paths: string[] },
    options?: { revalidate?: boolean },
  ) => Promise<DefaultMetadata>;
  readPull: (
    review: ReviewRef & { paths: string[] },
    base: DefaultMetadata,
    options?: { revalidate?: boolean },
  ) => Promise<DefaultMetadata>;
  quietClock?: QuietClock;
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
    cancel: null,
    immediate: false,
  };
  private reconciling = false;
  private dirty = false;
  private defaultViewedInFlight = 0;
  private readonly metadataWatch = metadataWatch();
  private readonly metadataRefresh = metadataRefreshState();
  private applied: ViewPlan | null = null;
  private treeKey: string | null = null;
  private regionKey = '';
  private treeNode: Element | null = null;
  private regionNodes: Element[] = [];
  private classifyKey = '';
  private unavailable = new Map<string, string>();
  private metadata: RepositoryMetadata;
  private readonly tracked: TrackedMetadata = trackedMetadata();
  private readonly quiet: QuietRevalidate;

  private readonly options: ReviewSessionOptions;

  constructor(options: ReviewSessionOptions) {
    this.options = options;
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
    this.quiet = sessionQuiet(options.root, options.quietClock, () =>
      this.requestRevalidation(),
    );
    installRedrawTrace(options.root);
    delete options.root.documentElement.dataset.diffseekFirstRenderEpoch;
    this.observer = new MutationObserver((records) => {
      const mode = scheduleForMutations(records);
      if (mode) this.onPageMutation(mode);
    });
    this.discoveryObserver = new MutationObserver((records) => {
      const mode = scheduleForMutations(records);
      if (!mode) return;
      this.refreshObservationRoots();
      this.onPageMutation(mode);
    });
    this.discoveryObserver.observe(options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  start(): void { this.reconcile(); }

  reconcile(): void {
    if (this.lifecycle.signal.aborted || this.reconciling) {
      this.dirty = true;
      return;
    }
    this.reconciling = true;
    // This pass reads the whole page, so a queued pass has nothing left to do.
    cancelPanelReconcile(this.scheduleState);
    try {
      do {
        this.dirty = false;
        this.reconcileOnce();
        // reconcileOnce writes these; a direct read is typed as a constant.
      } while (Object.is(this.dirty, true) && Object.is(this.lifecycle.signal.aborted, false));
    } finally {
      this.reconciling = false;
    }
  }

  stop(): void {
    if (this.lifecycle.signal.aborted) return;
    this.lifecycle.abort();
    this.quiet.cancel();
    this.options.metadataCommits.invalidate(this.options.review);
    this.actionExecutor.cancel();
    this.options.root.removeEventListener('click', this.onNativeClick, true);
    this.observer.disconnect();
    this.discoveryObserver.disconnect();
    this.observedRoots.clear();
    cancelPanelReconcile(this.scheduleState);
    this.clearInjected();
  }

  private reconcileOnce(): void {
    noteReconcileEntry(this.options.root);
    const firstObservation = !this.metadataWatch.ready;
    const metadataOpportunity =
      consumeMetadataOpportunity(this.metadataWatch, this.options.root) || firstObservation;
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
      if (metadataOpportunity) this.refreshMetadata();
      this.applied = null;
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
    if (this.reopenStaleMetadata() || metadataOpportunity) this.refreshMetadata();
    removeUnavailable(this.options.root);
    this.classifyIfNeeded(catalogSnapshot);
    this.presentView(catalogSnapshot, structureChanged);
  }

  /** Computes the desired view, then writes only what differs from the applied one. */
  private presentView(
    catalogSnapshot: SupportedSnapshot,
    structureChanged: boolean,
  ): void {
    const root = this.options.root;
    const defaultViewedPaths = this.metadataRefresh.settled
      ? pendingDefaultViewed(catalogSnapshot.files, this.options.filterDefaults, this.defaultViewedAttempts)
      : [];
    const generatedDefaultBusy =
      this.defaultViewedInFlight > 0 || defaultViewedPaths.length > 0;
    const menus = filterMenus(root);
    const plan = planView({
      files: catalogSnapshot.files,
      filters: this.filters,
      filterDefaults: this.options.filterDefaults,
      generatedDefaultBusy,
    });
    const change = changedSurfaces(this.applied, plan);
    this.applied = plan;
    const pageStale = structureChanged || change.page;
    const staleMenus = change.menu ? menus : menus.filter(menuNeedsRemount);
    if (!pageStale && staleMenus.length === 0 && defaultViewedPaths.length === 0) {
      // GitHub expanding a filtered file changes neither key. Re-collapse it.
      const expanded = filteredFileExpanded(root);
      if (expanded) this.presenter.apply(catalogSnapshot, this.filters);
      this.reattachObservers();
      if (!expanded) noteReconcileNoop(root);
      return;
    }
    trackDiffseekWrites(root, () => {
      if (pageStale) this.applyPage(catalogSnapshot);
      if (defaultViewedPaths.length > 0) {
        this.enqueueDefaultViewed(defaultViewedPaths);
      }
      for (const menu of staleMenus) {
        this.mountMenu(menu, catalogSnapshot, generatedDefaultBusy);
      }
    });
    this.reattachObservers();
    this.emitReconciled();
  }

  private applyPage(snapshot: SupportedSnapshot): void {
    const index = new ReviewIndex(snapshot.files);
    this.presenter.apply(snapshot, this.filters, index);
    mountViewedActions(
      snapshot,
      (target, viewed, paths) => this.batch(target, viewed, paths),
      index,
      this.filters,
    );
  }

  private reattachObservers(): void {
    this.discoveryObserver.observe(this.options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  /** Page noise during an auto-view batch is ignored; the batch ends with a pass. */
  private onPageMutation(options: PanelScheduleOptions): void {
    this.quiet.activity();
    if (this.defaultViewedInFlight === 0) this.schedule(options);
  }

  /**
   * The only way to request a pass besides `start` and the app's own
   * `reconcile`. Requests in the same task or frame share one pass.
   */
  private schedule(options: PanelScheduleOptions = {}): void {
    if (this.lifecycle.signal.aborted) return;
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

  private batch(target: ViewedTarget, viewed: boolean, paths: string[]): void {
    if (!this.snapshot) return;
    const progress = showBatchStarted(this.options.root, target, viewed);
    void this.actionExecutor
      .enqueue({
        reviewKey: this.options.review.key,
        generation: this.metadataRevision,
        viewed,
        paths,
      })
      .then((result) => {
        if (!result || this.lifecycle.signal.aborted) return dismissSnackbar(progress);
        showBatchResult(this.options.root, target, viewed, result, progress);
        this.schedule();
      });
  }

  private rememberFilterDefault(state: FilterDefaultState): void {
    showRememberedFilterDefault(this.options.root, state);
    void this.options.writeFilterDefaults(this.options.filterDefaults);
  }

  private enqueueDefaultViewed(paths: string[]): void {
    for (const path of paths) this.defaultViewedAttempts.add(path);
    this.defaultViewedInFlight += 1;
    const progress = showBatchStarted(this.options.root, 'auto-view', true);
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
        if (result) showBatchResult(this.options.root, 'auto-view', true, result, progress);
        else dismissSnackbar(progress);
        this.schedule();
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
      onChange: () => this.schedule(),
      onFilterDefaultChange: (_facet, state) =>
        this.rememberFilterDefault(state),
      onAlwaysReadChange: (enabled) => {
        if (!enabled) this.defaultViewedAttempts.clear();
        showAlwaysRead(this.options.root, enabled);
        void this.options.writeFilterDefaults(this.options.filterDefaults);
      },
      onViewed: (viewed, paths) => this.batch('category', viewed, paths),
    });
  }

  /** The path set, not its length: a same-sized tree can still gain a metadata file. */
  private reopenStaleMetadata(): boolean {
    const next = streamedMetadataStale(
      this.metadataRefresh.settled,
      this.tracked,
      this.catalogPaths(),
    );
    if (!next?.stale) return false;
    this.metadataRefresh.settled = false;
    return true;
  }

  private catalogPaths(): string[] {
    return this.catalog.files().map((file) => file.path);
  }

  private requestRevalidation(): void {
    if (this.lifecycle.signal.aborted) return;
    this.tracked.requested = true;
    this.metadataRefresh.settled = false;
    this.refreshMetadata();
  }

  private refreshMetadata(): void {
    loadSessionMetadata({
      state: this.metadataRefresh,
      tracked: this.tracked,
      quiet: this.quiet,
      paths: () => this.catalogPaths(),
      readDefault: (revalidate) =>
        this.options.refreshDefault(
          { ...this.options.review, paths: this.catalogPaths() },
          { revalidate },
        ),
      readPull: (base, revalidate) =>
        this.options.readPull(
          { ...this.options.review, paths: this.catalogPaths() },
          base,
          { revalidate },
        ),
      commit: (cache) =>
        this.options.metadataCommits.commit(
          this.options.review,
          this.metadataRevision,
          cache,
        ),
      aborted: () => this.lifecycle.signal.aborted,
      autoView: this.options.filterDefaults.viewed.has('generated'),
      current: () => this.metadata,
      needsPass: () =>
        excludedFacetCount(this.filters) > 0 ||
        this.options.filterDefaults.viewed.has('generated') ||
        filterMenus(this.options.root).length > 0,
      schedule: () => this.schedule({ coalesce: true }),
      store: (metadata) => {
        this.metadata = metadata;
        this.classifyKey = '';
      },
      reopen: () => this.reopenStaleMetadata(),
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
