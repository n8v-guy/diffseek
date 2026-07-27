import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import {
  scanPage,
  type PageSnapshot,
  viewedControlState,
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
  parseCodeowners,
  parseGitAttributes,
  type RepositoryMetadata,
  type RepositoryRef,
} from '@diffseek/repository-metadata';
import {
  emptyFacetExclusions,
  excludedFacetCount,
  FileCatalog,
  labelFiles,
  ReviewIndex,
} from '@diffseek/review';

import { ViewedActionExecutor } from './action-executor';

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
  private readonly onNativeClick: (event: MouseEvent) => void;
  private snapshot: SupportedSnapshot | null = null;
  private scheduled = false;
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
    this.observer.observe(options.root.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-labelledby', 'aria-pressed'],
    });
  }

  start(): void {
    this.reconcile();
    void this.refreshMetadata();
  }

  reconcile(): void {
    if (this.lifecycle.signal.aborted) return;
    const next = scanPage(this.options.root);
    if (!next.supported) {
      this.clearInjected();
      if (excludedFacetCount(this.filters) > 0) {
        showUnavailable(this.options.root, next.reason);
      }
      this.emitReconciled();
      return;
    }

    this.retainNativeOwners(next);
    this.catalog.merge(next.files);
    this.refreshViewedState(next);
    const catalogSnapshot: SupportedSnapshot = {
      ...next,
      files: this.catalog.files(),
    };
    this.snapshot = catalogSnapshot;
    removeUnavailable(this.options.root);
    this.classify(catalogSnapshot);
    this.applyDefaultViewed(catalogSnapshot);
    const index = new ReviewIndex(catalogSnapshot.files);
    this.presenter.apply(catalogSnapshot, this.filters, index);
    mountViewedActions(
      catalogSnapshot,
      (viewed, paths) => this.batch(viewed, paths),
      index,
    );
    for (const menu of filterMenus(this.options.root)) {
      mountFilterMenu(menu, {
        files: catalogSnapshot.files,
        filters: this.filters,
        filterDefaults: this.options.filterDefaults,
        onChange: () => this.reconcile(),
        onFilterDefaultChange: (facet, state) =>
          this.rememberFilterDefault(facet, state),
        onViewed: (viewed, paths) => this.batch(viewed, paths),
      });
    }
    this.emitReconciled();
  }

  stop(): void {
    if (this.lifecycle.signal.aborted) return;
    this.lifecycle.abort();
    this.options.metadataCommits.invalidate(this.options.review);
    this.actionExecutor.cancel();
    this.options.root.removeEventListener('click', this.onNativeClick, true);
    this.observer.disconnect();
    this.clearInjected();
  }

  private schedule(): void {
    if (this.lifecycle.signal.aborted || this.scheduled) return;
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

  private applyDefaultViewed(snapshot: SupportedSnapshot): void {
    if (!this.options.filterDefaults.viewed.has('generated')) return;
    const paths = snapshot.files
      .filter(
        (file) =>
          file.generated &&
          !file.viewed &&
          file.capabilities.viewed &&
          !this.defaultViewedAttempts.has(file.path),
      )
      .map((file) => file.path);
    if (paths.length === 0) return;
    for (const path of paths) this.defaultViewedAttempts.add(path);
    this.batch(true, paths);
  }

  private async refreshMetadata(): Promise<void> {
    const defaultResult = await this.options
      .refreshDefault(this.options.review)
      .catch(() => ({ metadata: this.metadata, changed: false }));
    if (this.lifecycle.signal.aborted) return;
    if (defaultResult.changed) {
      this.metadata = defaultResult.metadata;
      this.reconcile();
      await this.options.metadataCommits
        .commit(
          this.options.review,
          this.metadataRevision,
          defaultResult.metadata,
        )
        .catch(() => false);
      if (this.lifecycle.signal.aborted) return;
    }
    const pullMetadata = await this.options
      .readPull(this.options.review, this.metadata)
      .catch(() => this.metadata);
    if (
      !this.lifecycle.signal.aborted &&
      JSON.stringify(this.metadata) !== JSON.stringify(pullMetadata)
    ) {
      this.metadata = pullMetadata;
      this.reconcile();
    }
  }

  private classify(snapshot: SupportedSnapshot): void {
    labelFiles(snapshot.files, {
      attributes: parseGitAttributes(this.metadata.attributes),
      codeowners: this.metadata.codeowners
        ? parseCodeowners(this.metadata.codeowners)
        : [],
    });
  }

  private retainNativeOwners(snapshot: SupportedSnapshot): void {
    for (const file of snapshot.files) {
      if (file.owners.length > 0) {
        this.observedOwners.set(file.path, file.owners);
      } else {
        file.owners = this.observedOwners.get(file.path) ?? [];
      }
    }
  }

  private refreshViewedState(snapshot: SupportedSnapshot): void {
    for (const file of this.catalog.files()) {
      const control = snapshot.viewedControl(file.path);
      const viewed = control ? viewedControlState(control) : null;
      if (viewed != null) file.viewed = viewed;
    }
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
