import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { markViewed } from '@diffseek/github/review-page/viewed-actions';

import {
  installReviewPage,
  metadataSource,
  nextReconcile,
  openMenu,
  reviewApp,
  signalled,
  until,
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

function alwaysRead(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-diffseek-always-read]');
}

async function appliesAndUpdatesExtensionWideRememberedFilterDefaults(): Promise<void> {
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': { hidden: ['viewed'] },
  });
  openMenu();
  const app = await reviewApp({});

  const viewed = document.querySelector<HTMLButtonElement>(
    '[data-filter-kind="viewed"][data-filter-value="true"]',
  );
  expect(viewed?.getAttribute('aria-checked')).toBe('mixed');
  expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);

  viewed?.click();
  await until(async () => { expect(
      await fakeBrowser.storage.local.get('diffseek:filter-defaults'),
    ).toStrictEqual({
      'diffseek:filter-defaults': { hidden: [], viewed: [] },
    }); },
  );
  expect(document.getElementById('docs/readme.md')?.hidden).toBe(false);
  expect(
    [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)
      ?.textContent,
  ).toBe('Shown');

  document
    .querySelector<HTMLButtonElement>(
      '[data-filter-kind="viewed"][data-filter-value="true"]',
    )
    ?.click();
  document
    .querySelector<HTMLButtonElement>(
      '[data-filter-kind="viewed"][data-filter-value="true"]',
    )
    ?.click();
  await until(async () => { expect(
      await fakeBrowser.storage.local.get('diffseek:filter-defaults'),
    ).toStrictEqual({
      'diffseek:filter-defaults': {
        hidden: ['viewed'],
        viewed: [],
      },
    }); },
  );
  expect(
    document.querySelector<HTMLButtonElement>(
      '[data-filter-kind="viewed"][data-filter-value="true"]',
    )?.getAttribute('aria-checked'),
  ).toBe('mixed');
  expect(
    [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)
      ?.textContent,
  ).toBe('Always hidden');
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
  const app = await reviewApp({
    markFiles: signalled(markFiles),
  });

  document
    .querySelector<HTMLElement>(
      '#src\\/app\\.ts [data-diffseek-viewed-action]',
    )
    ?.click();

  await until(() => {
    expect(
      [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)
        ?.textContent,
    ).toBe("Couldn't mark file viewed. Try again.");
  });
  expect(markFiles).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    ['src/app.ts'],
    true,
    expect.anything(),
  );
  app.stop();
}

async function hidesAndMarksGeneratedFilesViewedFromThePersistedDefault(): Promise<void> {
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': {
      hidden: ['generated'],
      viewed: ['generated'],
    },
  });
  const markGate = Promise.withResolvers<undefined>();
  const markFiles = vi.fn<typeof markViewed>(async (snapshot, paths, viewed) => {
    await markGate.promise;
    for (const path of paths) {
      const control = snapshot.viewedControl(path);
      control?.setAttribute('aria-label', viewed ? 'Viewed' : 'Not Viewed');
      control?.setAttribute('aria-pressed', String(viewed));
    }
    return { completed: paths, failed: [], requested: paths.length };
  });
  openMenu();
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    ...metadataSource('src/generated.ts linguist-generated'),
  });

  await until(() => { expect(
      document.querySelector<HTMLButtonElement>(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )?.disabled,
    ).toBe(true); },
  );
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
  expect(
    document
      .querySelector('[data-diffseek-always-read]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
  await until(() => { expect(markFiles).toHaveBeenCalledWith(
      expect.anything(),
      ['src/generated.ts'],
      true,
      expect.anything(),
    ); },
  );

  const generated = document.querySelector<HTMLButtonElement>(
    '[data-filter-kind="generated"][data-filter-value="true"]',
  );
  generated?.click();
  expect(
    document
      .querySelector('[data-diffseek-always-read]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');

  markGate.resolve(undefined);
  await until(() => { expect(
      document.querySelector(
        '#diff-generated button[aria-label="Viewed"]',
      ),
    ).not.toBeNull(); },
  );
  await until(() => { expect(
      document.querySelector<HTMLButtonElement>(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )?.disabled,
    ).toBe(false); },
  );

  document
    .querySelector<HTMLButtonElement>(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    )
    ?.click();
  await until(() => { expect(
      document.querySelector(
        '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"][data-viewed-value="true"]',
      )?.getAttribute('aria-pressed'),
    ).toBe('true'); },
  );
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
  const app = await reviewApp({
    ...metadataSource('src/generated.ts linguist-generated'),
  });
  document
    .querySelector<HTMLButtonElement>(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    )
    ?.click();
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);

  await nextReconcile(removeLoadDiffNotice);

  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
  app.stop();
}

async function marksGeneratedFilesWhenAutoViewTurnsOnAndStopsWhenItTurnsOff(): Promise<void> {
  const markFiles = vi.fn<typeof markViewed>((snapshot, paths, viewed) => {
    for (const path of paths) {
      snapshot.viewedControl(path)?.setAttribute('aria-label', viewed ? 'Viewed' : 'Not Viewed');
      snapshot.viewedControl(path)?.setAttribute('aria-pressed', String(viewed));
    }
    return Promise.resolve({ completed: paths, failed: [], requested: paths.length });
  });
  openMenu();
  const app = await reviewApp({
    markFiles: signalled(markFiles),
    ...metadataSource('src/generated.ts linguist-generated'),
  });
  await until(() => { expect(alwaysRead()).not.toBeNull(); });
  alwaysRead()?.click();
  await until(() => { expect(markFiles).toHaveBeenCalledWith(expect.anything(), ['src/generated.ts'], true, expect.anything()); });
  // The auto-view batch must finish before the toggle is clicked again.
  await until(() => {
    expect(document.querySelector('#diff-generated button[aria-label="Viewed"]')).not.toBeNull();
    expect(document.querySelector('[data-filter-kind="generated"][data-filter-value="true"]')?.hasAttribute('disabled')).toBe(false);
  });
  expect(alwaysRead()?.getAttribute('aria-pressed')).toBe('true');
  alwaysRead()?.click();
  await until(async () => { expect(await fakeBrowser.storage.local.get('diffseek:filter-defaults')).toStrictEqual({
    'diffseek:filter-defaults': { hidden: [], viewed: [] },
  }); });
  const control = document.querySelector('#diff-generated button');
  control?.setAttribute('aria-label', 'Not Viewed');
  control?.setAttribute('aria-pressed', 'false');
  app.reconcile();
  expect(control?.getAttribute('aria-label')).toBe('Not Viewed');
  expect(markFiles).toHaveBeenCalledTimes(1);
  app.stop();
}

async function reconcilesANativeViewedStateChangedOnlyThroughAttributes(): Promise<void> {
  const app = await reviewApp({});
  const viewed = document.querySelector<HTMLButtonElement>(
    '#diff-app button[aria-label="Not Viewed"]',
  );
  viewed?.setAttribute('aria-label', 'Viewed');
  viewed?.setAttribute('aria-pressed', 'true');

  await until(() => {
    expect(
      document
        .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Unmark');
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
  document
    .querySelector<HTMLButtonElement>(
      '[data-filter-kind="owners"][data-filter-value="@owner"]',
    )
    ?.click();
  document
    .querySelector<HTMLButtonElement>(
      '[data-filter-kind="owners"][data-filter-value="@org/team"]',
    )
    ?.click();
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);

  await nextReconcile(() => {
    const region = document.getElementById('diff-generated');
    region?.querySelector('[role="tooltip"]')?.remove();
    if (!region) return;
    region.replaceWith(region.cloneNode(true));
  });

  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
  app.stop();
}

async function rollsBackPresentationWhenGitHubContractsDisappear(): Promise<void> {
  openMenu();
  const app = await reviewApp({
    ...metadataSource('src/** group=Code'),
  });
  document
    .querySelector<HTMLButtonElement>('[data-filter-value="Code"]')
    ?.click();
  expect(
    (document.getElementById('diff-app'))?.dataset.diffseekFilteredOut,
  ).toBe('true');

  await nextReconcile(() => {
    document.querySelector('[role="tree"]')?.remove();
  });

  expect(
    (document.getElementById('diff-config'))?.dataset.diffseekFilteredOut,
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
  expect(document.getElementById('src/app.ts')?.hidden).toBe(true);

  await nextReconcile(() => {
    path = '/octo/repo/pull/2/changes';
    document.body.append(document.createElement('span'));
  });

  expect(document.getElementById('docs/readme.md')?.hidden).toBe(false);
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

  document
    .querySelector<HTMLButtonElement>(
      '#src\\/app\\.ts [data-diffseek-viewed-action]',
    )
    ?.click();
  await until(() => {
    expect(markFiles).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      ['src/app.ts'],
      true,
      expect.anything(),
    );
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
