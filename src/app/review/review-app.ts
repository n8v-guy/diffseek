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

type ReviewAppOptions = {
  root?: Document;
  pathname?: () => string;
  hash?: () => string;
  replace?: (url: string) => void;
  readImmediate?: (repository: RepositoryRef) => Promise<RepositoryMetadata>;
  refreshDefault?: (
    repository: RepositoryRef,
  ) => Promise<{ metadata: RepositoryMetadata; changed: boolean }>;
  readPull?: (
    review: ReviewRef,
    fallback: RepositoryMetadata,
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
  const changesPath = changesPathFromClassic(pathname());
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
  const metadataCommits = new MetadataCommitGuard(writeCache);
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
