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
  isNativeMutation,
  removeInjected,
  removeUnavailable,
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
  classifyKeyFor,
  classifySnapshot,
  projectionKeyFor,
  refreshViewedState,
  retainNativeOwners,
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
  private scheduled = false;
  private reconciling = false;
  private dirty = false;
  private defaultViewedInFlight = 0;
  private projectionFingerprint = '';
  private treeKey: string | null = null;
  private regionKey = '';
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
    this.observer = new MutationObserver((records) => {
      if (records.some(isNativeMutation)) this.schedule();
    });
    this.discoveryObserver = new MutationObserver((records) => {
      if (!records.some(isNativeMutation)) return;
      this.refreshObservationRoots();
      this.schedule();
    });
    this.discoveryObserver.observe(options.root.body, {
      childList: true,
      subtree: true,
    });
    this.refreshObservationRoots();
  }

  start(): void {
    this.reconcile();
    void this.refreshMetadata();
  }

  reconcile(): void {
    if (this.lifecycle.signal.aborted || this.reconciling) {
      this.dirty = true;
      return;
    }
    this.reconciling = true;
    this.scheduled = false;
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
    this.clearInjected();
  }

  private reconcileOnce(): void {
    const treeKey = treeStructureKey(this.options.root);
    const regionKey = regionStructureKey(this.options.root);
    let next: PageSnapshot;
    if (treeKey != null && treeKey === this.treeKey && this.snapshot) {
      if (regionKey === this.regionKey) {
        // Attribute-only churn: refresh viewed/capabilities on the catalog.
        refreshObservedFiles(this.options.root, this.catalog.files());
        next = bindSnapshot(
          this.options.root,
          this.catalog.files(),
          this.unavailable,
        );
      } else {
        // Region mount/dup churn: rescan membership without dropping labels.
        next = scanPage(this.options.root);
        this.regionKey = regionKey;
      }
    } else {
      next = scanPage(this.options.root);
      this.treeKey = treeKey;
      this.regionKey = regionKey;
      this.classifyKey = '';
    }
    if (!next.supported) {
      this.projectionFingerprint = '';
      this.treeKey = null;
      this.regionKey = '';
      this.classifyKey = '';
      this.clearInjected();
      if (excludedFacetCount(this.filters) > 0) {
        showUnavailable(this.options.root, next.reason);
      }
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
    const defaultViewedPaths = this.defaultViewedPaths(catalogSnapshot);
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
    const index = new ReviewIndex(catalogSnapshot.files);
    this.presenter.apply(catalogSnapshot, this.filters, index);
    mountViewedActions(
      catalogSnapshot,
      (viewed, paths) => this.batch(viewed, paths),
      index,
    );
    if (fingerprint === this.projectionFingerprint) {
      for (const menu of menus) {
        if (menuNeedsRemount(menu)) {
          this.mountMenu(menu, catalogSnapshot, generatedDefaultBusy);
        }
      }
      this.emitReconciled();
      return;
    }
    this.projectionFingerprint = fingerprint;
    if (defaultViewedPaths.length > 0) {
      this.enqueueDefaultViewed(defaultViewedPaths);
    }
    for (const menu of menus) {
      this.mountMenu(menu, catalogSnapshot, generatedDefaultBusy);
    }
    this.refreshObservationRoots();
    this.emitReconciled();
  }

  private schedule(): void {
    if (this.lifecycle.signal.aborted || this.defaultViewedInFlight > 0) {
      return;
    }
    if (this.reconciling) {
      this.dirty = true;
      return;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.reconcile();
    });
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
    if (facet === 'generated' && state !== 'hidden-viewed') {
      this.defaultViewedAttempts.clear();
    }
    showRememberedFilterDefault(this.options.root, facet, state);
    void this.options.writeFilterDefaults(this.options.filterDefaults);
  }

  private defaultViewedPaths(snapshot: SupportedSnapshot): string[] {
    if (!this.options.filterDefaults.viewed.has('generated')) return [];
    return snapshot.files
      .filter(
        (file) =>
          file.generated &&
          !file.viewed &&
          file.capabilities.viewed &&
          !this.defaultViewedAttempts.has(file.path),
      )
      .map((file) => file.path);
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
      onViewed: (viewed, paths) => this.batch(viewed, paths),
    });
  }

  private async refreshMetadata(): Promise<void> {
    const pullMetadata = await this.options
      .readPull(this.options.review, this.metadata)
      .catch(() => this.metadata);
    if (this.lifecycle.signal.aborted) return;
    if (JSON.stringify(this.metadata) !== JSON.stringify(pullMetadata)) {
      this.metadata = pullMetadata;
      this.classifyKey = '';
      this.reconcile();
    }
    const defaultResult = await this.options
      .refreshDefault(this.options.review)
      .catch(() => ({ metadata: this.metadata, changed: false }));
    if (this.lifecycle.signal.aborted || !defaultResult.changed) return;
    await this.options.metadataCommits
      .commit(
        this.options.review,
        this.metadataRevision,
        defaultResult.metadata,
      )
      .catch(() => false);
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
    this.options.root.dispatchEvent(new CustomEvent('diffseek-reconciled'));
  }
}

function menuNeedsRemount(menu: HTMLElement): boolean {
  if (menu.dataset.diffseekMenuOwned !== 'true') return true;
  if (!menu.querySelector(':scope > [data-diffseek="filters"]')) return true;
  return [...menu.children].some(
    (child) =>
      child instanceof HTMLElement &&
      child.dataset.diffseek !== 'filters' &&
      !child.hidden,
  );
}
