import { writeCache } from '@diffseek/browser/cache';
import {
  type FilterDefaults,
  readFilterDefaults,
  writeFilterDefaults,
} from '@diffseek/browser/filter-defaults';
import { markViewed } from '@diffseek/github/review-page/viewed-actions';
import {
  changesPathFromClassic,
  reviewFromPath,
  type ReviewRef,
} from '@diffseek/github/routing/page-route';
import {
  MetadataCommitGuard,
  type RepositoryMetadata,
  type RepositoryRef,
} from '@diffseek/repository-metadata';

import {
  readImmediateMetadata,
  readPullMetadata,
  refreshDefaultMetadata,
} from '../metadata/reader';
import { ReviewSession } from './review-session';

export interface ReviewApp {
  reconcile: () => void;
  stop: () => void;
}

interface AppDependencies {
  markFiles: typeof markViewed;
  readFilterDefaults: () => Promise<FilterDefaults>;
  readImmediate: (repository: RepositoryRef) => Promise<RepositoryMetadata>;
  readPull: (
    review: ReviewRef,
    fallback: RepositoryMetadata,
  ) => Promise<RepositoryMetadata>;
  refreshDefault: (
    repository: RepositoryRef,
  ) => Promise<{ changed: boolean; metadata: RepositoryMetadata; }>;
  writeFilterDefaults: (defaults: FilterDefaults) => Promise<void>;
}

interface ReviewAppOptions {
  hash?: () => string;
  markFiles?: typeof markViewed;
  pathname?: () => string;
  readFilterDefaults?: () => Promise<FilterDefaults>;
  readImmediate?: (repository: RepositoryRef) => Promise<RepositoryMetadata>;
  readPull?: (
    review: ReviewRef,
    fallback: RepositoryMetadata,
  ) => Promise<RepositoryMetadata>;
  refreshDefault?: (
    repository: RepositoryRef,
  ) => Promise<{ changed: boolean; metadata: RepositoryMetadata; }>;
  replace?: (url: string) => void;
  root?: Document;
  search?: () => string;
  writeFilterDefaults?: (defaults: FilterDefaults) => Promise<void>;
}

const idleReview: ReviewApp = {
  reconcile(): void {
    // The classic route redirected before a session existed.
  },
  stop(): void {
    // The classic route redirected before a session existed.
  },
};

class ActiveReview implements ReviewApp {
  private readonly dependencies: AppDependencies;
  private readonly filterDefaults: FilterDefaults;
  private generation = 0;
  private readonly lifecycle = new AbortController();
  private readonly metadataCommits: MetadataCommitGuard;
  private readonly observer: MutationObserver;
  private readonly pathname: () => string;
  private review: null | ReviewRef = null;
  private readonly root: Document;
  private scheduled = false;
  private session: null | ReviewSession = null;

  constructor(
    root: Document,
    pathname: () => string,
    dependencies: AppDependencies,
    filterDefaults: FilterDefaults,
  ) {
    this.root = root;
    this.pathname = pathname;
    this.dependencies = dependencies;
    this.filterDefaults = filterDefaults;
    this.metadataCommits = new MetadataCommitGuard(writeCache);
    this.observer = new MutationObserver((): void => {
      this.onMutation();
    });
  }

  onMutation(): void {
    if (this.lifecycle.signal.aborted || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask((): void => {
      this.onMutationTask();
    });
  }

  onMutationTask(): void {
    this.scheduled = false;
    const next = reviewFromPath(this.pathname());
    if (next?.key !== this.review?.key) void this.replaceSession(next);
  }

  async open(): Promise<void> {
    this.observer.observe(this.root.body, { childList: true, subtree: true });
    await this.replaceSession(reviewFromPath(this.pathname()));
  }

  reconcile(): void {
    if (this.lifecycle.signal.aborted) return;
    const next = reviewFromPath(this.pathname());
    if (next?.key === this.review?.key) {
      this.session?.reconcile();
      return;
    }
    void this.replaceSession(next);
  }

  replaced(expectedGeneration: number, next: ReviewRef): boolean {
    return (
      this.lifecycle.signal.aborted ||
      expectedGeneration !== this.generation ||
      this.review?.key !== next.key
    );
  }

  async replaceSession(next: null | ReviewRef): Promise<void> {
    const expectedGeneration = ++this.generation;
    this.session?.stop();
    this.session = null;
    this.review = next;
    if (next === null) {
      this.root.dispatchEvent(new CustomEvent('diffseek-reconciled'));
      return;
    }
    const metadata = await this.dependencies.readImmediate(next);
    if (this.replaced(expectedGeneration, next)) return;
    this.session = new ReviewSession({
      filterDefaults: this.filterDefaults,
      markFiles: this.dependencies.markFiles,
      metadata,
      metadataCommits: this.metadataCommits,
      readPull: this.dependencies.readPull,
      refreshDefault: this.dependencies.refreshDefault,
      review: next,
      root: this.root,
      writeFilterDefaults: this.dependencies.writeFilterDefaults,
    });
    this.session.start();
  }

  stop(): void {
    if (this.lifecycle.signal.aborted) return;
    this.lifecycle.abort();
    this.generation += 1;
    this.observer.disconnect();
    this.session?.stop();
    this.session = null;
    this.review = null;
  }
}

export async function startReviewApp(
  options: ReviewAppOptions = {},
): Promise<ReviewApp> {
  const root = options.root ?? document;
  const pathname = options.pathname ?? ((): string => location.pathname);
  const search = options.search ?? ((): string => location.search);
  const changesPath = isSignedOut(root)
    ? null
    : changesPathFromClassic(pathname(), search());
  if (changesPath !== null) {
    redirectClassic(options, changesPath);
    return idleReview;
  }
  const dependencies = dependenciesFrom(options);
  const app = new ActiveReview(
    root,
    pathname,
    dependencies,
    await dependencies.readFilterDefaults(),
  );
  await app.open();
  return app;
}

function dependenciesFrom(options: ReviewAppOptions): AppDependencies {
  return {
    markFiles: options.markFiles ?? markViewed,
    readFilterDefaults: options.readFilterDefaults ?? readFilterDefaults,
    readImmediate: options.readImmediate ?? readImmediateMetadata,
    readPull: options.readPull ?? readPullMetadata,
    refreshDefault: options.refreshDefault ?? refreshDefaultMetadata,
    writeFilterDefaults: options.writeFilterDefaults ?? writeFilterDefaults,
  };
}

/** GitHub renders an empty `user-login` meta for signed-out visitors. */
function isSignedOut(root: Document): boolean {
  return root.querySelector('meta[name="user-login"]')?.getAttribute('content') === '';
}

function redirectClassic(options: ReviewAppOptions, changesPath: string): void {
  const hash = options.hash?.() ?? location.hash;
  const replace = options.replace ?? location.replace.bind(location);
  replace(`${changesPath}${hash}`);
}
