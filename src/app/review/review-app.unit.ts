import type { markViewed } from '@diffseek/github/review-page/viewed-actions';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alwaysRead,
  checked,
  clickFacet,
  facetButton,
  installReviewPage,
  isHidden,
  lastSnackbar,
  markCall,
  markNatively,
  metadataSource,
  nextReconcile,
  openMenu,
  reviewApp,
  saveFilterDefaults,
  setViewed,
  signalled,
  storedFilterDefaults,
  until,
  viewedAction,
} from './review-app.fixture';

describe('review app interactions', () => {
  beforeEach(async (): Promise<void> => {
    await installReviewPage();
  });

  it('hides and marks generated files viewed from the persisted default', hidesAndMarksGeneratedFilesViewedFromThePersistedDefault);
  it('marks generated files when auto-view turns on and stops when it turns off', marksGeneratedFilesWhenAutoViewTurnsOnAndStopsWhenItTurnsOff);
  it('applies and updates extension-wide remembered filter defaults', appliesAndUpdatesExtensionWideRememberedFilterDefaults);
  it('asks to try again after a failed viewed action without retrying', asksToTryAgainAfterAFailedViewedActionWithoutRetrying);
  it('suppresses a batch result from an earlier pull request', suppressesABatchResultFromAnEarlierPullRequest);
  it('starts a new pull request with no inherited filter selection', startsANewPullRequestWithNoInheritedFilterSelection);
  it('rolls back presentation when GitHub contracts disappear', rollsBackPresentationWhenGitHubContractsDisappear);
  it('reconciles a native viewed state changed only through attributes', reconcilesANativeViewedStateChangedOnlyThroughAttributes);
  it('keeps attribute-generated labels after GitHub loads the diff', keepsAttributeGeneratedLabelsAfterGitHubLoadsTheDiff);
  it('retains observed native owners across diff hydration', retainsObservedNativeOwnersAcrossDiffHydration);
});

const generatedAttributes = 'src/generated.ts linguist-generated';

async function appliesAndUpdatesExtensionWideRememberedFilterDefaults(): Promise<void> {
  await saveFilterDefaults({ hidden: ['viewed'] });
  openMenu();
  const app = await reviewApp({});

  expect(checked('viewed')).toBe('mixed');
  expect(isHidden('docs/readme.md')).toBe(true);

  clickFacet('viewed');
  await until(async () => {
    expect(await storedFilterDefaults()).toStrictEqual({ hidden: [], viewed: [] });
  });
  expect(isHidden('docs/readme.md')).toBe(false);
  expect(lastSnackbar()).toBe('Shown');

  clickFacet('viewed');
  clickFacet('viewed');
  await until(async () => {
    expect(await storedFilterDefaults()).toStrictEqual({ hidden: ['viewed'], viewed: [] });
  });
  expect(checked('viewed')).toBe('mixed');
  expect(lastSnackbar()).toBe('Always hidden');
  app.stop();
}

async function asksToTryAgainAfterAFailedViewedActionWithoutRetrying(): Promise<void> {
  const filterButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Filter options"]',
  );
  filterButton?.removeAttribute('aria-label');
  filterButton?.setAttribute('aria-labelledby', 'filter-options-label');
  const label = document.createElement('span');
  label.id = 'filter-options-label';
  label.textContent = 'Filter options';
  document.body.prepend(label);
  const markFiles = vi.fn<typeof markViewed>().mockResolvedValue({
    completed: [],
    failed: ['src/app.ts'],
    requested: 1,
  });
  const app = await reviewApp({ markFiles: signalled(markFiles) });

  viewedAction('src/app.ts')?.click();

  await until(() => {
    expect(lastSnackbar()).toBe("Couldn't mark file viewed. Try again.");
  });
  expect(markFiles).toHaveBeenCalledExactlyOnceWith(...markCall(['src/app.ts']));
  app.stop();
}

async function hidesAndMarksGeneratedFilesViewedFromThePersistedDefault(): Promise<void> {
  await saveFilterDefaults({ hidden: ['generated'], viewed: ['generated'] });
  const markGate = Promise.withResolvers<undefined>();
  const markFiles = vi.fn<typeof markViewed>(async (...args) => {
    await markGate.promise;
    return markNatively(...args);
  });
  openMenu();
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    ...metadataSource(generatedAttributes),
  });

  await until(() => { expect(facetButton('generated')?.disabled).toBe(true); });
  expect(isHidden('src/generated.ts')).toBe(true);
  expect(alwaysRead()?.getAttribute('aria-pressed')).toBe('true');
  await until(() => {
    expect(markFiles).toHaveBeenCalledWith(...markCall(['src/generated.ts']));
  });

  clickFacet('generated');
  expect(alwaysRead()?.getAttribute('aria-pressed')).toBe('true');

  markGate.resolve(undefined);
  await until(() => {
    expect(document.querySelector('#diff-generated button[aria-label="Viewed"]')).not.toBeNull();
  });
  await until(() => { expect(facetButton('generated')?.disabled).toBe(false); });

  clickFacet('generated');
  await until(() => {
    expect(
      document.querySelector(
        '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"][data-viewed-value="true"]',
      )?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
  app.stop();
}

function isLoadDiffNotice(element: Element): boolean {
  const trimmed = element.textContent.trim();
  return trimmed === 'Load Diff' || trimmed.includes(
    'Some generated files are not rendered by default',
  );
}

async function keepsAttributeGeneratedLabelsAfterGitHubLoadsTheDiff(): Promise<void> {
  openMenu();
  const app = await reviewApp(metadataSource(generatedAttributes));
  clickFacet('generated');
  expect(isHidden('src/generated.ts')).toBe(true);

  await nextReconcile(removeLoadDiffNotice);

  expect(isHidden('src/generated.ts')).toBe(true);
  app.stop();
}

async function marksGeneratedFilesWhenAutoViewTurnsOnAndStopsWhenItTurnsOff(): Promise<void> {
  const markFiles = vi.fn<typeof markViewed>(markNatively);
  openMenu();
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    ...metadataSource(generatedAttributes),
  });
  await until(() => { expect(alwaysRead()).not.toBeNull(); });
  alwaysRead()?.click();
  await until(() => {
    expect(markFiles).toHaveBeenCalledWith(...markCall(['src/generated.ts']));
  });
  // The auto-view batch must finish before the toggle is clicked again.
  await until(() => {
    expect(document.querySelector('#diff-generated button[aria-label="Viewed"]')).not.toBeNull();
    expect(facetButton('generated')?.hasAttribute('disabled')).toBe(false);
  });
  expect(alwaysRead()?.getAttribute('aria-pressed')).toBe('true');
  alwaysRead()?.click();
  await until(async () => {
    expect(await storedFilterDefaults()).toStrictEqual({ hidden: [], viewed: [] });
  });
  const control = document.querySelector('#diff-generated button');
  setViewed(control, false);
  app.reconcile();
  expect(control?.getAttribute('aria-label')).toBe('Not Viewed');
  expect(markFiles).toHaveBeenCalledTimes(1);
  app.stop();
}

async function reconcilesANativeViewedStateChangedOnlyThroughAttributes(): Promise<void> {
  const app = await reviewApp({});
  setViewed(document.querySelector('#diff-app button[aria-label="Not Viewed"]'), true);

  await until(() => {
    expect(viewedAction('src/app.ts')?.getAttribute('aria-label')).toBe('Unmark');
  });
  app.stop();
}

function removeLoadDiffNotice(): void {
  const region = document.getElementById('diff-generated');
  if (region === null) return;
  for (const element of region.querySelectorAll('button, p')) {
    if (isLoadDiffNotice(element)) element.remove();
  }
  region.replaceWith(region.cloneNode(true));
}

async function retainsObservedNativeOwnersAcrossDiffHydration(): Promise<void> {
  openMenu();
  const app = await reviewApp({});
  clickFacet('owners', '@owner');
  clickFacet('owners', '@org/team');
  expect(isHidden('src/generated.ts')).toBe(true);

  await nextReconcile(() => {
    const region = document.getElementById('diff-generated');
    region?.querySelector('[role="tooltip"]')?.remove();
    if (!region) return;
    region.replaceWith(region.cloneNode(true));
  });

  expect(isHidden('src/generated.ts')).toBe(true);
  app.stop();
}

async function rollsBackPresentationWhenGitHubContractsDisappear(): Promise<void> {
  openMenu();
  const app = await reviewApp(metadataSource('src/** group=Code'));
  document
    .querySelector<HTMLButtonElement>('[data-filter-value="Code"]')
    ?.click();
  expect(
    (document.getElementById('diff-app'))?.dataset['diffseekFilteredOut'],
  ).toBe('true');

  await nextReconcile(() => {
    document.querySelector('[role="tree"]')?.remove();
  });

  expect(
    (document.getElementById('diff-config'))?.dataset['diffseekFilteredOut'],
  ).toBeUndefined();
  expect(
    document.querySelector('#diff-config button')?.getAttribute('aria-label'),
  ).toBe('Collapse file');
  expect(
    document.querySelector('[data-diffseek="unavailable"]')?.textContent,
  ).toBe('DiffSeek unavailable. No file tree on this page');
  app.stop();
}

async function startsANewPullRequestWithNoInheritedFilterSelection(): Promise<void> {
  let path = '/octo/repo/pull/1/changes';
  openMenu();
  const app = await reviewApp({
    pathname: () => path,
    ...metadataSource('src/** group=Code'),
  });
  document
    .querySelector<HTMLButtonElement>('[data-filter-value="Code"]')
    ?.click();
  expect(isHidden('src/app.ts')).toBe(true);

  await nextReconcile(() => {
    path = '/octo/repo/pull/2/changes';
    document.body.append(document.createElement('span'));
  });

  expect(isHidden('docs/readme.md')).toBe(false);
  expect(
    document.querySelector('[data-filter-value="Code"]')?.getAttribute(
      'aria-checked',
    ),
  ).toBe('true');
  app.stop();
}

async function suppressesABatchResultFromAnEarlierPullRequest(): Promise<void> {
  let path = '/octo/repo/pull/1/changes';
  const batch = Promise.withResolvers<{
    completed: string[];
    failed: string[];
    requested: number;
  }>();
  const markFiles = vi.fn<typeof markViewed>(() => batch.promise);
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    pathname: () => path,
  });

  viewedAction('src/app.ts')?.click();
  await until(() => {
    expect(markFiles).toHaveBeenCalledExactlyOnceWith(...markCall(['src/app.ts']));
  });

  await nextReconcile(() => {
    path = '/octo/repo/pull/2/changes';
    document.body.append(document.createElement('span'));
  });
  batch.resolve({
    completed: [],
    failed: ['src/app.ts'],
    requested: 1,
  });
  await Promise.resolve();

  expect(
    document.querySelector('[data-diffseek="snackbars"]'),
  ).toBeNull();
  app.stop();
}
