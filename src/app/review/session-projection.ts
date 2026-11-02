import type { FilterDefaults, FilterDefaultState } from '@diffseek/browser/filter-defaults';
import type { markViewed, ViewedTarget } from '@diffseek/github/review-page/viewed-actions';
import type { ReviewRef } from '@diffseek/github/routing/page-route';
import type { RepositoryMetadata } from '@diffseek/repository-metadata';

import { fileToggleAction, type PageSnapshot } from '@diffseek/github/review-page/page-adapter';
import { mountFilterMenu } from '@diffseek/github/review-view/filter-menu';
import { ReviewPresenter } from '@diffseek/github/review-view/presenter';
import {
  afterNextPaint,
  dismissSnackbar,
  filterMenus,
  menuNeedsRemount,
  removeInjected,
  showAlwaysRead,
  showBatchResult,
  showBatchStarted,
  showRememberedFilterDefault,
  showUnavailable,
} from '@diffseek/github/review-view/review-ui';
import { emptyFacetExclusions, excludedFacetCount } from '@diffseek/review';

import { ViewedActionExecutor } from './action-executor';
import { trackDiffseekWrites } from './redraw-trace';
import {
  enqueueDefaultViewed,
  pendingDefaultViewed,
  projectionKeyFor,
  type ProjectionPass,
  viewedPathFromClick,
  writeSessionProjection,
} from './review-session-pass';
import { collapseFileLabel } from './session-observation';

export interface SessionProjectionOptions {
  aborted: () => boolean;
  filterDefaults: FilterDefaults;
  markFiles: typeof markViewed;
  metadataRevision: number;
  reconcile: () => void;
  review: ReviewRef;
  root: Document;
  schedule: () => void;
  snapshot: () => null | SupportedSnapshot;
  writeFilterDefaults: (defaults: FilterDefaults) => Promise<void>;
}

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

/** The session's writes: filter menus, file projection, and viewed batches. */
export class SessionProjection {
  private readonly actionExecutor: ViewedActionExecutor;
  private readonly defaultViewedAttempts = new Set<string>();
  private defaultViewedInFlight = 0;
  private readonly filters = emptyFacetExclusions();
  private readonly onNativeClick: (event: MouseEvent) => void;
  private readonly options: SessionProjectionOptions;
  private readonly presenter = new ReviewPresenter();
  private projectionFingerprint = '';

  constructor(options: SessionProjectionOptions) {
    this.options = options;
    for (const facet of options.filterDefaults.hidden) {
      this.filters.get(facet)?.add('true');
    }
    this.actionExecutor = new ViewedActionExecutor({
      beforeExecute: (): Promise<void> => afterNextPaint(options.root),
      current: (): null | {
        generation: number;
        reviewKey: string;
        snapshot: SupportedSnapshot;
      } => {
        const snapshot = options.snapshot();
        return snapshot === null
          ? null
          : {
              generation: options.metadataRevision,
              reviewKey: options.review.key,
              snapshot,
            };
      },
      markFiles: options.markFiles,
    });
    this.onNativeClick = (event: MouseEvent): void => {
      const path = this.nativeViewedPath(event);
      if (path !== undefined && path !== '') this.actionExecutor.invalidate(path);
    };
    options.root.addEventListener('click', this.onNativeClick, { capture: true });
  }

  /** Returns whether the projection was rewritten. */
  apply(
    catalogSnapshot: SupportedSnapshot,
    structureChanged: boolean,
    metadata: RepositoryMetadata,
  ): boolean {
    const projection = this.projectionFor(catalogSnapshot, metadata);
    if (!structureChanged && !projection.changed && projection.staleMenus.length === 0) {
      if (filteredFileExpanded(this.options.root)) {
        this.presenter.apply(catalogSnapshot, this.filters);
      }
      return false;
    }
    this.renderProjection(catalogSnapshot, structureChanged, projection);
    return true;
  }

  clear(snapshot: null | SupportedSnapshot): void {
    this.projectionFingerprint = '';
    this.presenter.reset(snapshot);
    removeInjected(this.options.root);
  }

  defaultViewedBusy(): boolean {
    return this.defaultViewedInFlight > 0;
  }

  reportUnavailable(reason: string): void {
    if (excludedFacetCount(this.filters) > 0) {
      showUnavailable(this.options.root, reason);
    }
  }

  stop(): void {
    this.actionExecutor.cancel();
    this.options.root.removeEventListener('click', this.onNativeClick, true);
  }

  private batch(target: ViewedTarget, viewed: boolean, paths: string[]): void {
    if (this.options.snapshot() === null) return;
    void this.reportBatch(target, viewed, paths);
  }

  private enqueueDefaultViewed(paths: string[]): void {
    for (const path of paths) this.defaultViewedAttempts.add(path);
    this.defaultViewedInFlight += 1;
    const progress = showBatchStarted(this.options.root, 'auto-view', true);
    void this.reportDefaultViewed(paths, progress);
  }

  private mountMenu(
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
        this.options.reconcile();
      },
      onFilterDefaultChange: (_facet, state): void => {
        this.rememberFilterDefault(state);
      },
      onViewed: (viewed, paths): void => {
        this.batch('category', viewed, paths);
      },
    });
  }

  private nativeViewedPath(event: MouseEvent): string | undefined {
    return viewedPathFromClick(event, this.options.root.defaultView, this.options.snapshot());
  }

  private projectionFor(
    catalogSnapshot: SupportedSnapshot,
    metadata: RepositoryMetadata,
  ): ProjectionPass {
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
      metadata,
      metadataRevision: this.options.metadataRevision,
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

  private rememberFilterDefault(state: FilterDefaultState): void {
    showRememberedFilterDefault(this.options.root, state);
    void this.options.writeFilterDefaults(this.options.filterDefaults);
  }

  private renderProjection(
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

  private async reportBatch(
    target: ViewedTarget,
    viewed: boolean,
    paths: string[],
  ): Promise<void> {
    const progress = showBatchStarted(this.options.root, target, viewed);
    const result = await this.actionExecutor.enqueue({
      generation: this.options.metadataRevision,
      paths,
      reviewKey: this.options.review.key,
      viewed,
    });
    if (result === null || this.options.aborted()) {
      dismissSnackbar(progress);
      return;
    }
    showBatchResult(this.options.root, target, viewed, result, progress);
    this.options.schedule();
  }

  private async reportDefaultViewed(
    paths: string[],
    progress: HTMLElement | null,
  ): Promise<void> {
    const result = await enqueueDefaultViewed(
      (command) => this.actionExecutor.enqueue(command),
      {
        generation: this.options.metadataRevision,
        paths,
        reviewKey: this.options.review.key,
        viewed: true,
      },
    );
    this.defaultViewedInFlight = Math.max(0, this.defaultViewedInFlight - 1);
    if (this.options.aborted()) return;
    if (result === null) dismissSnackbar(progress);
    else showBatchResult(this.options.root, 'auto-view', true, result, progress);
    this.options.reconcile();
  }
}

/** A filtered-out file GitHub expanded again. Structure and labels stay put. */
function filteredFileExpanded(root: Document): boolean {
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-diffseek-filtered-out="true"] button',
  )) {
    if (fileToggleAction(button) === collapseFileLabel) return true;
  }
  return false;
}
