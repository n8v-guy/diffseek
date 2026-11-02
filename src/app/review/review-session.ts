import type { FilterDefaults, FilterDefaultState } from '@diffseek/browser/filter-defaults';
import {
  bindSnapshot,
  type PageSnapshot,
  refreshObservedFiles,
  regionStructureKey,
  scanPage,
  treeStructureKey,
} from '@diffseek/github/review-page/page-adapter';
import type { markViewed, ViewedTarget } from '@diffseek/github/review-page/viewed-actions';
import { mountFilterMenu } from '@diffseek/github/review-view/filter-menu';
import { ReviewPresenter } from '@diffseek/github/review-view/presenter';
import {
  afterNextPaint,
  dismissSnackbar,
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
import type { MetadataCommitGuard, RepositoryMetadata, RepositoryRef } from '@diffseek/repository-metadata';
import { emptyFacetExclusions, excludedFacetCount, FileCatalog } from '@diffseek/review';

import { ViewedActionExecutor } from './action-executor';
import {
  consumeMetadataOpportunity,
  loadReviewMetadata,
  metadataRefreshState,
  metadataWatch,
} from './metadata-refresh';
import { installRedrawTrace, noteReconcile, trackDiffseekWrites } from './redraw-trace';
import {
  enqueueDefaultViewed,
  viewedPathFromClick,
  writeSessionProjection,
} from './review-session-pass';
import {
  cancelPanelReconcile,
  classifyKeyFor,
  classifySnapshot,
  filteredFileExpanded,
  freshPanelSchedule,
  pageNodesChanged,
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

interface ProjectionPass {
  changed: boolean;
  defaultViewedPaths: string[];
  fingerprint: string;
  generatedDefaultBusy: boolean;
  menus: HTMLElement[];
  staleMenus: HTMLElement[];
}
type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

type UnsupportedSnapshot = Extract<PageSnapshot, { supported: false }>;

const fileTreeSelector = '[role="tree"][aria-label="File Tree"]';
const diffRegionSelector = '[role="region"][id^="diff-"]';

export class ReviewSession {
  private readonly actionExecutor: ViewedActionExecutor;
  private readonly catalog = new FileCatalog();
  private classifyKey = '';
  private readonly defaultViewedAttempts = new Set<string>();
  private defaultViewedInFlight = 0;
  private dirty = false;
  private readonly discoveryObserver: MutationObserver;
  private readonly filters = emptyFacetExclusions();
  private readonly lifecycle = new AbortController();
  private metadata: RepositoryMetadata;
  private readonly metadataRefresh = metadataRefreshState();
  private readonly metadataRevision: number;
  private readonly metadataWatch = metadataWatch();
  private readonly observedOwners = new Map<string, string[]>();
  private readonly observedRoots = new Set<Element>();
  private readonly observer: MutationObserver;
  private readonly onNativeClick: (event: MouseEvent) => void;
  private readonly options: ReviewSessionOptions;
  private readonly presenter = new ReviewPresenter();
  private projectionFingerprint = '';
  private reconciling = false;
  private regionKey = '';
  private regionNodes: Element[] = [];
  private readonly scheduleState = freshPanelSchedule();
  private snapshot: null | SupportedSnapshot = null;
  private treeKey: null | string = null;
  private treeNode: Element | null = null;
  private unavailable = new Map<string, string>();

  constructor(options: ReviewSessionOptions) {
    this.options = options;
    for (const facet of options.filterDefaults.hidden) {
      this.filters.get(facet)?.add('true');
    }
    this.metadata = options.metadata;
    this.metadataRevision = options.metadataCommits.begin(options.review);
    this.actionExecutor = new ViewedActionExecutor({
      beforeExecute: (): Promise<void> => afterNextPaint(options.root),
      current: (): null | {
        generation: number;
        reviewKey: string;
        snapshot: SupportedSnapshot;
      } =>
        this.snapshot === null
          ? null
          : {
              generation: this.metadataRevision,
              reviewKey: options.review.key,
              snapshot: this.snapshot,
            },
      markFiles: options.markFiles,
    });
    this.onNativeClick = (event: MouseEvent): void => {
      const path = this.nativeViewedPath(event);
      if (path !== undefined && path !== '') this.actionExecutor.invalidate(path);
    };
    options.root.addEventListener('click', this.onNativeClick, { capture: true });
    installRedrawTrace(options.root);
    delete options.root.documentElement.dataset['diffseekFirstRenderEpoch'];
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
    this.discoveryObserver.observe(options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  abandonPage(next: UnsupportedSnapshot): void {
    this.projectionFingerprint = '';
    this.treeKey = null;
    this.regionKey = '';
    this.classifyKey = '';
    this.treeNode = null;
    this.regionNodes = [];
    this.clearInjected();
    if (excludedFacetCount(this.filters) > 0) {
      showUnavailable(this.options.root, next.reason);
    }
    this.reattachObservers();
    this.emitReconciled();
  }

  adoptSnapshot(next: SupportedSnapshot): SupportedSnapshot {
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

  applySupported(next: SupportedSnapshot, structureChanged: boolean): void {
    const catalogSnapshot = this.adoptSnapshot(next);
    const projection = this.projectionFor(catalogSnapshot);
    if (!structureChanged && !projection.changed && projection.staleMenus.length === 0) {
      this.keepProjection(catalogSnapshot);
      return;
    }
    this.renderProjection(catalogSnapshot, structureChanged, projection);
    this.reattachObservers();
    this.emitReconciled();
  }

  batch(target: ViewedTarget, viewed: boolean, paths: string[]): void {
    if (this.snapshot === null) return;
    const progress = showBatchStarted(this.options.root, target, viewed);
    void this.reportBatch(target, viewed, paths, progress);
  }

  capturePage(): { next: PageSnapshot; structureChanged: boolean } {
    const root = this.options.root;
    const treeKey = treeStructureKey(root);
    const regionKey = regionStructureKey(root);
    const tree = root.querySelector(fileTreeSelector);
    const regions = [...root.querySelectorAll<HTMLElement>(diffRegionSelector)];
    const structureChanged =
      treeKey !== this.treeKey ||
      regionKey !== this.regionKey ||
      pageNodesChanged(this.treeNode, tree, this.regionNodes, regions);
    const next = this.snapshotFor(root, treeKey, regionKey);
    this.treeNode = tree;
    this.regionNodes = regions;
    return { next, structureChanged };
  }

  classifyIfNeeded(snapshot: SupportedSnapshot): void {
    const nextKey = classifyKeyFor(this.metadata, snapshot.files);
    if (nextKey === this.classifyKey) {
      syncViewedLabels(snapshot.files);
      return;
    }
    classifySnapshot(snapshot, this.metadata);
    this.classifyKey = nextKey;
  }

  clearInjected(): void {
    this.presenter.reset(this.snapshot);
    this.snapshot = null;
    removeInjected(this.options.root);
  }

  continueReconcile(): boolean {
    return this.dirty && !this.lifecycle.signal.aborted;
  }

  emitReconciled(): void {
    noteReconcile(this.options.root);
    this.options.root.dispatchEvent(new CustomEvent('diffseek-reconciled'));
  }

  enqueueDefaultViewed(paths: string[]): void {
    for (const path of paths) this.defaultViewedAttempts.add(path);
    this.defaultViewedInFlight += 1;
    const progress = showBatchStarted(this.options.root, 'auto-view', true);
    void this.reportDefaultViewed(paths, progress);
  }

  keepProjection(catalogSnapshot: SupportedSnapshot): void {
    if (filteredFileExpanded(this.options.root)) {
      this.presenter.apply(catalogSnapshot, this.filters);
    }
    this.reattachObservers();
  }

  mountMenu(
    menu: HTMLElement,
    snapshot: SupportedSnapshot,
    generatedDefaultBusy: boolean,
  ): void {
    mountFilterMenu(menu, {
      files: snapshot.files,
      filterDefaults: this.options.filterDefaults,
      filters: this.filters,
      generatedDefaultBusy,
      onAlwaysReadChange: (enabled): void => {
        if (!enabled) this.defaultViewedAttempts.clear();
        showAlwaysRead(this.options.root, enabled);
        void this.options.writeFilterDefaults(this.options.filterDefaults);
      },
      onChange: (): void => {
        this.reconcile();
      },
      onFilterDefaultChange: (_facet, state): void => {
        this.rememberFilterDefault(state);
      },
      onViewed: (viewed, paths): void => {
        this.batch('category', viewed, paths);
      },
    });
  }

  nativeViewedPath(event: MouseEvent): string | undefined {
    return viewedPathFromClick(event, this.options.root.defaultView, this.snapshot);
  }

  projectionFor(catalogSnapshot: SupportedSnapshot): ProjectionPass {
    const defaultViewedPaths = pendingDefaultViewed(
      catalogSnapshot.files,
      this.options.filterDefaults,
      this.defaultViewedAttempts,
    );
    const generatedDefaultBusy =
      this.defaultViewedInFlight > 0 || defaultViewedPaths.length > 0;
    const menus = filterMenus(this.options.root);
    const fingerprint = projectionKeyFor({
      files: catalogSnapshot.files,
      filterDefaults: this.options.filterDefaults,
      filters: this.filters,
      generatedDefaultBusy,
      menuCount: menus.length,
      metadata: this.metadata,
      metadataRevision: this.metadataRevision,
    });
    return {
      changed: fingerprint !== this.projectionFingerprint,
      defaultViewedPaths,
      fingerprint,
      generatedDefaultBusy,
      menus,
      staleMenus: menus.filter(menuNeedsRemount),
    };
  }

  reattachObservers(): void {
    this.discoveryObserver.observe(this.options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
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

  reconcileOnce(): void {
    if (consumeMetadataOpportunity(this.metadataWatch, this.options.root)) {
      this.refreshMetadata();
    }
    this.observer.disconnect();
    this.discoveryObserver.disconnect();
    this.observedRoots.clear();
    const page = this.capturePage();
    if (!page.next.supported) {
      this.abandonPage(page.next);
      return;
    }
    this.applySupported(page.next, page.structureChanged);
  }

  reconcilePasses(): void {
    do {
      this.dirty = false;
      this.reconcileOnce();
    } while (this.continueReconcile());
  }

  refreshMetadata(): void {
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

  refreshObservationRoots(): void {
    watchObservationRoots({
      observedRoots: this.observedRoots,
      observer: this.observer,
      root: this.options.root,
    });
  }

  rememberFilterDefault(state: FilterDefaultState): void {
    showRememberedFilterDefault(this.options.root, state);
    void this.options.writeFilterDefaults(this.options.filterDefaults);
  }

  renderProjection(
    catalogSnapshot: SupportedSnapshot,
    structureChanged: boolean,
    projection: ProjectionPass,
  ): void {
    trackDiffseekWrites(this.options.root, (): void => {
      writeSessionProjection({
        batch: (target, viewed, paths): void => {
          this.batch(target, viewed, paths);
        },
        catalogSnapshot,
        enqueueDefault: (paths): void => {
          this.enqueueDefaultViewed(paths);
        },
        filters: this.filters,
        mount: (menu, snapshot, busy): void => {
          this.mountMenu(menu, snapshot, busy);
        },
        presenter: this.presenter,
        projection,
        setFingerprint: (fingerprint): void => {
          this.projectionFingerprint = fingerprint;
        },
        structureChanged,
      });
    });
  }

  async reportBatch(
    target: ViewedTarget,
    viewed: boolean,
    paths: string[],
    progress: HTMLElement | null,
  ): Promise<void> {
    const result = await this.actionExecutor.enqueue({
      generation: this.metadataRevision,
      paths,
      reviewKey: this.options.review.key,
      viewed,
    });
    if (result === null || this.lifecycle.signal.aborted) {
      dismissSnackbar(progress);
      return;
    }
    showBatchResult(this.options.root, target, viewed, result, progress);
    this.schedule();
  }

  async reportDefaultViewed(
    paths: string[],
    progress: HTMLElement | null,
  ): Promise<void> {
    const result = await enqueueDefaultViewed(
      (command) => this.actionExecutor.enqueue(command),
      {
        generation: this.metadataRevision,
        paths,
        reviewKey: this.options.review.key,
        viewed: true,
      },
    );
    this.defaultViewedInFlight = Math.max(0, this.defaultViewedInFlight - 1);
    if (this.lifecycle.signal.aborted) return;
    if (result === null) dismissSnackbar(progress);
    else showBatchResult(this.options.root, 'auto-view', true, result, progress);
    this.reconcile();
  }

  schedule(options: PanelScheduleOptions = {}): void {
    if (this.lifecycle.signal.aborted || this.defaultViewedInFlight > 0) return;
    if (this.reconciling) {
      this.dirty = true;
      return;
    }
    queuePanelReconcile(this.scheduleState, this.options.root, options, (): void => {
      this.reconcile();
    });
  }

  snapshotFor(
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
      return bindSnapshot(root, this.catalog.files(), this.unavailable);
    }
    if (treeKey !== this.treeKey) this.classifyKey = '';
    this.treeKey = treeKey;
    this.regionKey = regionKey;
    return scanPage(root);
  }

  start(): void {
    this.reconcile();
    this.refreshMetadata();
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
    cancelPanelReconcile(this.scheduleState);
    this.clearInjected();
  }

}
