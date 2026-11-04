import {
  readFilterDefaults,
  writeCache,
  writeFilterDefaults,
  type FilterDefaults,
  type RepositoryCache,
} from '@diffseek/browser';
import {
  changesPathFromClassic,
  markViewed,
  reviewFromPath,
  type ReviewRef,
} from '@diffseek/github';
import {
  MetadataCommitGuard,
  type RepositoryMetadata,
  type RepositoryRef,
} from '@diffseek/repository-metadata';

import {
  readImmediateMetadata,
  readPullMetadata,
  refreshDefaultMetadata,
  type DefaultMetadata,
} from '../metadata/reader';

import { ReviewSession } from './review-session';

type ReviewAppOptions = {
  root?: Document;
  pathname?: () => string;
  search?: () => string;
  hash?: () => string;
  replace?: (url: string) => void;
  readImmediate?: (repository: RepositoryRef) => Promise<RepositoryMetadata>;
  refreshDefault?: (
    review: ReviewRef & { paths: string[] },
  ) => Promise<DefaultMetadata>;
  readPull?: (
    review: ReviewRef & { paths: string[] },
    base: DefaultMetadata,
  ) => Promise<RepositoryMetadata>;
  markFiles?: typeof markViewed;
  readFilterDefaults?: () => Promise<FilterDefaults>;
  writeFilterDefaults?: (defaults: FilterDefaults) => Promise<void>;
};

export type ReviewApp = {
  reconcile: () => void;
  stop: () => void;
};

export async function startReviewApp(
  options: ReviewAppOptions = {},
): Promise<ReviewApp> {
  const root = options.root ?? document;
  const pathname = options.pathname ?? (() => location.pathname);
  const search = options.search ?? (() => location.search);
  const changesPath = isSignedOut(root)
    ? null
    : changesPathFromClassic(pathname(), search());
  if (changesPath) {
    const hash = options.hash?.() ?? location.hash;
    (options.replace ?? location.replace.bind(location))(`${changesPath}${hash}`);
    return { reconcile() {}, stop() {} };
  }
  const dependencies = {
    readImmediate: options.readImmediate ?? readImmediateMetadata,
    refreshDefault: options.refreshDefault ?? refreshDefaultMetadata,
    readPull: options.readPull ?? readPullMetadata,
    markFiles: options.markFiles ?? markViewed,
    readFilterDefaults: options.readFilterDefaults ?? readFilterDefaults,
    writeFilterDefaults: options.writeFilterDefaults ?? writeFilterDefaults,
  };
  const filterDefaults = await dependencies.readFilterDefaults();
  const metadataCommits = new MetadataCommitGuard<RepositoryCache>(writeCache);
  const lifecycle = new AbortController();
  let session: ReviewSession | null = null;
  let review: ReviewRef | null = null;
  let generation = 0;
  let scheduled = false;

  const replaceSession = async (next: ReviewRef | null) => {
    const expectedGeneration = ++generation;
    session?.stop();
    session = null;
    review = next;
    if (!next) {
      root.dispatchEvent(new CustomEvent('diffseek-reconciled'));
      return;
    }

    const metadata = await dependencies.readImmediate(next);
    if (
      lifecycle.signal.aborted ||
      expectedGeneration !== generation ||
      review?.key !== next.key
    ) {
      return;
    }
    session = new ReviewSession({
      root,
      review: next,
      metadata,
      metadataCommits,
      refreshDefault: dependencies.refreshDefault,
      readPull: dependencies.readPull,
      markFiles: dependencies.markFiles,
      filterDefaults,
      writeFilterDefaults: dependencies.writeFilterDefaults,
    });
    session.start();
  };

  const reconcile = () => {
    if (lifecycle.signal.aborted) return;
    const next = reviewFromPath(pathname());
    if (next?.key === review?.key) {
      session?.reconcile();
      return;
    }
    void replaceSession(next);
  };

  const observer = new MutationObserver(() => {
    if (lifecycle.signal.aborted || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const next = reviewFromPath(pathname());
      if (next?.key !== review?.key) void replaceSession(next);
    });
  });
  observer.observe(root.body, { childList: true, subtree: true });
  await replaceSession(reviewFromPath(pathname()));

  return {
    reconcile,
    stop() {
      if (lifecycle.signal.aborted) return;
      lifecycle.abort();
      generation += 1;
      observer.disconnect();
      session?.stop();
      session = null;
      review = null;
    },
  };
}

/** GitHub renders an empty `user-login` meta for signed-out visitors. */
function isSignedOut(root: Document): boolean {
  return root.querySelector('meta[name="user-login"]')?.getAttribute('content') === '';
}
