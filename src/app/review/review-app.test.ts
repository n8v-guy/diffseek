import type { markViewed } from '@diffseek/github/review-page/viewed-actions';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { ReviewApp } from './review-app';

import {
  type ImmediateReader,
  installReviewPage,
  marked,
  metadataSource,
  nextReconcile,
  openMenu,
  type PullReader,
  pullReview,
  reviewApp,
  signalled,
  until,
} from './review-app.fixture';

describe('fresh filter defaults', () => {
  beforeEach(async (): Promise<void> => {
    await installReviewPage();
  });

  it('hides generated and viewed files and turns auto-view on for a fresh install', hidesGeneratedAndViewedFilesAndTurnsAutoViewOnForAFreshInstall);
  it('hides generated and viewed files until they are shown again', hidesGeneratedAndViewedFilesUntilTheyAreShownAgain);
  it('respects a saved preference that hides only viewed files', respectsASavedPreferenceThatHidesOnlyViewedFiles);
});

function checked(kind: string): null | string {
  return facetButton(kind)?.getAttribute('aria-checked') ?? null;
}

function clickFacet(kind: string): void {
  facetButton(kind)?.click();
}

function facetButton(kind: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    `[data-filter-kind="${CSS.escape(kind)}"][data-filter-value="true"]`,
  );
}

function facetCount(facet: string): null | string {
  return document.querySelector(
    `.diffseek-menu-row:has([data-filter-kind="${CSS.escape(facet)}"][data-filter-value="true"]) .diffseek-menu-count`,
  )?.textContent ?? null;
}

async function hidesGeneratedAndViewedFilesAndTurnsAutoViewOnForAFreshInstall(): Promise<void> {
  await fakeBrowser.storage.local.clear();
  openMenu();
  const markFiles = marked(['src/generated.ts']);
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    ...metadataSource('src/generated.ts linguist-generated'),
  });

  await until(() => { expect(
      document
        .querySelector('[data-diffseek-always-read]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true'); },
  );
  await until(() => { expect(markFiles).toHaveBeenCalledWith(
      expect.anything(),
      ['src/generated.ts'],
      true,
      expect.anything(),
    ); },
  );
  expect(
    document
      .querySelector('[data-filter-kind="viewed"][data-filter-value="true"]')
      ?.getAttribute('aria-checked'),
  ).toBe('mixed');
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
  expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
  expect(
    (await fakeBrowser.storage.local.get('diffseek:filter-defaults'))[
      'diffseek:filter-defaults'
    ],
  ).toBeUndefined();
  app.stop();
}

async function hidesGeneratedAndViewedFilesUntilTheyAreShownAgain(): Promise<void> {
  // The fresh hiding defaults with auto-view switched off.
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': { hidden: ['viewed', 'generated'], viewed: [] },
  });
  openMenu();
  const markFiles = marked(['src/generated.ts']);
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    ...metadataSource('src/generated.ts linguist-generated'),
  });

  await until(() => { expect(checked('generated')).toBe('mixed'); });
  expect(checked('viewed')).toBe('mixed');
  expect(isHidden('docs/readme.md')).toBe(true);
  expect(isHidden('src/generated.ts')).toBe(true);
  expect(isHidden('src/app.ts')).toBe(false);
  expect(facetCount('viewed')).toBe('0/1');
  expect(facetCount('generated')).toBe('0/1');

  clickFacet('viewed');
  await until(() => { expect(isHidden('docs/readme.md')).toBe(false); });
  expect(checked('viewed')).toBe('true');
  expect(isHidden('src/generated.ts')).toBe(true);

  clickFacet('generated');
  await until(() => {
    expect(checked('generated')).toBe('true');
    expect(isHidden('src/generated.ts')).toBe(false);
  });
  expect(pressed('[data-diffseek-always-read]')).toBe('false');
  expect(markFiles).not.toHaveBeenCalled();

  clickFacet('generated');
  clickFacet('generated');
  clickFacet('generated');
  await until(() => { expect(checked('generated')).toBe('true'); });
  expect(markFiles).not.toHaveBeenCalled();
  await until(async () => {
    expect(await fakeBrowser.storage.local.get('diffseek:filter-defaults')).toStrictEqual({
      'diffseek:filter-defaults': { hidden: [], viewed: [] },
    });
  });
  app.stop();
}

function isHidden(id: string): 'until-found' | boolean | undefined {
  return document.getElementById(id)?.hidden;
}

function pressed(selector: string): null | string {
  return document.querySelector(selector)?.getAttribute('aria-pressed') ?? null;
}

async function respectsASavedPreferenceThatHidesOnlyViewedFiles(): Promise<void> {
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': { hidden: ['viewed'], viewed: [] },
  });
  openMenu();
  const app = await reviewApp({
    ...metadataSource('src/generated.ts linguist-generated'),
  });

  await until(() => { expect(
      document.querySelector(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )?.getAttribute('aria-checked'),
    ).toBe('true'); },
  );
  expect(
    document.querySelector(
      '[data-filter-kind="viewed"][data-filter-value="true"]',
    )?.getAttribute('aria-checked'),
  ).toBe('mixed');
  expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(false);
  expect(
    document.querySelector(
      '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count',
    )?.textContent,
  ).toBe('1/1');
  app.stop();
}

const immediate = { attributes: 'docs/** group=Docs', codeowners: '' };
const loaded = {
  attributes: 'src/generated.ts linguist-generated',
  codeowners: '',
};

describe('metadata refresh', () => {
  beforeEach(async (): Promise<void> => {
    await installReviewPage();
  });

  it('retries a failed read when the filter menu opens and then applies it', retriesAFailedReadWhenTheFilterMenuOpensAndThenAppliesIt);
  it('retries a failed read when the file tree changes', retriesAFailedReadWhenTheFileTreeChanges);
  it('does not start another metadata read while one is in flight', doesNotStartAnotherMetadataReadWhileOneIsInFlight);
  it('keeps cached metadata when the pull-head read fails', keepsCachedMetadataWhenThePullHeadReadFails);
});

async function doesNotStartAnotherMetadataReadWhileOneIsInFlight(): Promise<void> {
  const pull = Promise.withResolvers<typeof loaded>();
  const readPull = vi.fn<PullReader>(() => pull.promise);
  const app = await immediateReaders(readPull);
  await until(() => { expect(readPull).toHaveBeenCalledExactlyOnceWith(pullReview, immediate); });
  openMenu();
  app.reconcile();
  document.querySelector('[role="tree"]')?.append(document.createElement('li'));
  app.reconcile();
  expect(readPull).toHaveBeenCalledExactlyOnceWith(pullReview, immediate);

  pull.resolve(loaded);
  await until(() => { expect(document.querySelector('[data-filter-kind="generated"]')).not.toBeNull(); },
  );
  expect(readPull).toHaveBeenCalledExactlyOnceWith(pullReview, immediate);
  app.stop();
}

async function ignoreRejection(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

function immediateReaders(readPull: PullReader): Promise<ReviewApp> {
  return reviewApp({
    readImmediate: () => Promise.resolve(immediate),
    readPull: signalled(readPull),
    refreshDefault: () => Promise.resolve({ changed: false, metadata: immediate }),
  });
}

async function keepsCachedMetadataWhenThePullHeadReadFails(): Promise<void> {
  openMenu();
  const readPull = vi.fn<PullReader>(() => Promise.reject(new Error('offline')));
  const app = await reviewApp({
    readImmediate: (): ReturnType<ImmediateReader> => Promise.resolve({
      attributes: 'src/** group=FromCache',
      codeowners: '',
    }),
    readPull: signalled(readPull),
    refreshDefault: () => Promise.resolve({
      changed: false,
      metadata: { attributes: 'src/** group=FromCache', codeowners: '' },
    }),
  });
  await until(() => { expect(document.querySelector('[data-filter-value="FromCache"]')).not.toBeNull(); },
  );
  expect(readPull).toHaveBeenCalledExactlyOnceWith(pullReview, {
    attributes: 'src/** group=FromCache',
    codeowners: '',
  });
  app.reconcile();
  expect(readPull).toHaveBeenCalledExactlyOnceWith(pullReview, {
    attributes: 'src/** group=FromCache',
    codeowners: '',
  });
  app.stop();
}

async function retriesAFailedReadWhenTheFileTreeChanges(): Promise<void> {
  const { app, readPull } = await startRetry();

  await nextReconcile(() => {
    const item = document.createElement('li');
    item.id = 'src/extra.ts';
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-label', 'extra.ts');
    document.querySelector('[role="tree"]')?.append(item);
  });
  await until(() => { expect(readPull).toHaveBeenCalledTimes(2); });
  openMenu();
  app.reconcile();
  expect(readPull).toHaveBeenCalledTimes(2);
  await until(() => { expect(document.querySelector('[data-filter-kind="generated"]')).not.toBeNull(); },
  );
  app.stop();
}

async function retriesAFailedReadWhenTheFilterMenuOpensAndThenAppliesIt(): Promise<void> {
  await fakeBrowser.storage.local.clear();
  const { app, readPull } = await startRetry();
  expect(document.querySelector('[data-filter-kind="generated"]')).toBeNull();

  openMenu();
  app.reconcile();
  await until(() => { expect(readPull).toHaveBeenCalledTimes(2); });
  await until(() => { expect(
      document.querySelector('[data-filter-kind="generated"][data-filter-value="true"]')?.getAttribute('aria-checked'),
    ).toBe('mixed'); },
  );
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
  app.stop();
}

async function startRetry(): Promise<{
  app: ReviewApp;
  readPull: ReturnType<typeof vi.fn<PullReader>>;
}> {
  const failed = Promise.reject(new Error('offline'));
  const ignored = ignoreRejection(failed);
  const readPull = vi.fn<PullReader>()
    .mockReturnValueOnce(failed)
    .mockResolvedValueOnce(loaded);
  const app = await immediateReaders(readPull);
  await until(() => {
    expect(readPull).toHaveBeenCalledExactlyOnceWith(pullReview, immediate);
  });
  await ignored;
  return { app, readPull };
}

describe('review app reuse invariants', () => {
  beforeEach(async (): Promise<void> => {
    await installReviewPage();
  });

  it('keeps classifications after a structure-key rescan', keepsClassificationsAfterAStructureKeyRescan);
  it('recovers mutation scheduling after default mark-viewed rejects', recoversMutationSchedulingAfterDefaultMarkViewedRejects);
  it('repairs an owned menu after GitHub replaces its children', repairsAnOwnedMenuAfterGitHubReplacesItsChildren);
});

async function keepsClassificationsAfterAStructureKeyRescan(): Promise<void> {
  openMenu();
  const app = await reviewApp({
    readImmediate: () => Promise.resolve({
      attributes: 'src/generated.ts linguist-generated\nsrc/** group=Code',
      codeowners: '',
    }),
  });

  await until(() => { expect(
      document.querySelector(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      ),
    ).not.toBeNull(); },
  );

  await nextReconcile(() => {
    const tree = document.querySelector('[role="tree"]');
    const folder = document.createElement('li');
    folder.id = 'src';
    folder.setAttribute('role', 'treeitem');
    folder.setAttribute('aria-label', 'src');
    tree?.prepend(folder);
  });

  expect(
    document.querySelector(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    ),
  ).not.toBeNull();
  expect(
    document.querySelector(
      '[data-filter-kind="groups"][data-filter-value="Code"]',
    ),
  ).not.toBeNull();
  app.stop();
}

async function recoversMutationSchedulingAfterDefaultMarkViewedRejects(): Promise<void> {
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': {
      hidden: ['generated'],
      viewed: ['generated'],
    },
  });
  openMenu();
  const app = await reviewApp({
    markFiles: vi.fn<typeof markViewed>(() => Promise.reject(new Error('native mark failed'))),
    ...metadataSource('src/generated.ts linguist-generated'),
  });

  await until(() => { expect(
      document.querySelector<HTMLButtonElement>(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )?.disabled,
    ).toBe(false); },
  );

  await nextReconcile(() => {
    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.setAttribute('aria-pressed', 'true');
    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.setAttribute('aria-label', 'Viewed');
  });

  await until(() => { expect(
      document
        .querySelector<HTMLButtonElement>(
          '#src\\/app\\.ts [data-diffseek-viewed-action]',
        )
        ?.getAttribute('aria-pressed'),
    ).toBe('true'); },
  );
  app.stop();
}

async function repairsAnOwnedMenuAfterGitHubReplacesItsChildren(): Promise<void> {
  openMenu();
  const app = await reviewApp({});

  await until(() => { expect(document.querySelector('[data-diffseek="filters"]')).not.toBeNull(); },
  );
  const menu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Filter options"]',
  );
  expect(menu?.dataset['diffseekMenuOwned']).toBe('true');

  await nextReconcile(() => {
    menu?.querySelector('[data-diffseek="filters"]')?.remove();
    const native = document.createElement('li');
    native.textContent = 'native again';
    menu?.append(native);
  });

  expect(document.querySelector('[data-diffseek="filters"]')).not.toBeNull();
  expect(
    [...(menu?.children ?? [])].some(
      (child) =>
        child instanceof HTMLElement &&
        child.dataset['diffseek'] !== 'filters' &&
        child.hidden === false,
    ),
  ).toBe(false);
  app.stop();
}
