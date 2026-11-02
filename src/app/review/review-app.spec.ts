import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { type ReviewApp, startReviewApp } from './review-app';
import {
  type DefaultRefresher,
  fixture,
  type ImmediateReader,
  installNativeBehavior,
  installReviewPage,
  metadataSource,
  nextReconcile,
  openMenu,
  type PullReader,
  pullReview,
  replaceBody,
  reviewApp,
  signalled,
  until,
} from './review-app.fixture';

describe('review app lifecycle', () => {
  beforeEach(async (): Promise<void> => {
    await installReviewPage();
  });

  it('replaces the classic review route before starting a session', replacesTheClassicReviewRouteBeforeStartingASession);
  it('stays on the classic route GitHub sent the visitor back to', staysOnTheClassicRouteGitHubSentTheVisitorBackTo);
  it('leaves signed-out visitors on the classic route', leavesSignedOutVisitorsOnTheClassicRoute);
  it('replaces cached metadata with PR-head content while default refresh stays isolated', replacesCachedMetadataWithPRHeadContentWhileDefaultRefreshStaysIsolated);
  it('continues to PR-head metadata when the default refresh fails', continuesToPRHeadMetadataWhenTheDefaultRefreshFails);
  it('keeps PR-head metadata when the default-branch cache write fails', keepsPRHeadMetadataWhenTheDefaultBranchCacheWriteFails);
  it('adopts default-branch attributes when the pull-head read keeps failing', adoptsDefaultBranchAttributesWhenThePullHeadReadKeepsFailing);
  it('classifies immediately from cached metadata and mounts ephemeral UI once', classifiesImmediatelyFromCachedMetadataAndMountsEphemeralUIOnce);
  it('reconciles menu recreation, filtering, and a replaced tree', reconcilesMenuRecreationFilteringAndAReplacedTree);
  it('re-collapses a filtered file after GitHub expands it', reCollapsesAFilteredFileAfterGitHubExpandsIt);
  it('keeps a collapsed folder and its known files in the review session', keepsACollapsedFolderAndItsKnownFilesInTheReviewSession);
  it('cleans up on partial navigation and extension invalidation', cleansUpOnPartialNavigationAndExtensionInvalidation);
  it('activates after partial navigation into a review', activatesAfterPartialNavigationIntoAReview);
});

async function activatesAfterPartialNavigationIntoAReview(): Promise<void> {
  let path = '/octo/repo/issues/1';
  replaceBody('<main>Issue</main>');
  const app = await reviewApp({
    pathname: () => path,
  });

  await nextReconcile(() => {
    path = '/octo/repo/pull/1/changes';
    const parsed = new DOMParser().parseFromString(fixture, 'text/html');
    document.body.replaceChildren(
      ...[...parsed.body.childNodes].map((node) => document.importNode(node, true)),
    );
    installNativeBehavior();
    openMenu();
  });
  expect(document.querySelector('[data-diffseek="filters"]')).not.toBeNull();
  expect(document.querySelectorAll('[data-diffseek-viewed-action]')).toHaveLength(5);
  app.stop();
}

async function adoptsDefaultBranchAttributesWhenThePullHeadReadKeepsFailing(): Promise<void> {
  await fakeBrowser.storage.local.clear();
  openMenu();
  const app = await reviewApp({
    readImmediate: () => Promise.resolve({
      attributes: 'docs/** group=Docs',
      codeowners: '',
    }),
    readPull: () => Promise.reject(new Error('offline')),
    refreshDefault: () => Promise.resolve({
      changed: true,
      metadata: {
        attributes: 'src/generated.ts linguist-generated',
        codeowners: '',
      },
    }),
  });

  await until(() => { expect(
      document
        .querySelector(
          '[data-filter-kind="generated"][data-filter-value="true"]',
        )
        ?.getAttribute('aria-checked'),
    ).toBe('mixed'); },
  );
  expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
  app.stop();
}

function cachedMetadata(): { attributes: string; codeowners: string } {
  return { attributes: 'src/** group=cached', codeowners: '' };
}

async function classifiesImmediatelyFromCachedMetadataAndMountsEphemeralUIOnce(): Promise<void> {
  openMenu();
  const refreshDefault = vi.fn<DefaultRefresher>().mockResolvedValue({
    changed: false,
    metadata: {
      attributes: 'src/** group=Code',
      codeowners: '*.ts @cached',
    },
  });
  const app = await reviewApp({
    readImmediate: () => Promise.resolve({
      attributes: 'src/** group=Code',
      codeowners: '*.ts @cached',
    }),
    refreshDefault: signalled(refreshDefault),
  });

  const filters = document.querySelector('[data-diffseek="filters"]');
  expect(filters).not.toBeNull();
  expect(document.body.textContent).toContain('Code');
  expect(document.body.textContent).toContain('@cached');
  expect(document.querySelectorAll('[data-diffseek-viewed-action]')).toHaveLength(5);
  expect(refreshDefault).toHaveBeenCalledExactlyOnceWith(pullReview);

  app.reconcile();
  expect(document.querySelector('[data-diffseek="filters"]')).toBe(filters);
  expect(document.querySelectorAll('[data-diffseek-viewed-action]')).toHaveLength(5);
  app.stop();
}

async function cleansUpOnPartialNavigationAndExtensionInvalidation(): Promise<void> {
  let path = '/octo/repo/pull/1/changes';
  openMenu();
  const app = await reviewApp({
    pathname: () => path,
  });

  await nextReconcile(() => {
    path = '/octo/repo/issues/1';
    document.body.append(document.createElement('span'));
  });
  expect(document.querySelector('[data-diffseek="filters"]')).toBeNull();
  expect(document.querySelector('[data-diffseek-viewed-action]')).toBeNull();

  app.stop();
  openMenu();
  await Promise.resolve();
  expect(document.querySelector('[data-diffseek="filters"]')).toBeNull();
}

async function continuesToPRHeadMetadataWhenTheDefaultRefreshFails(): Promise<void> {
  const { app, readPull } = await openCachedPull(
    () => Promise.reject(new Error('default unavailable')),
  );

  await until(() => { expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(); },
  );
  expect(readPull).toHaveBeenCalledWith(
    expect.objectContaining({ pull: 1 }),
    cachedMetadata(),
  );
  app.stop();
}

async function keepsACollapsedFolderAndItsKnownFilesInTheReviewSession(): Promise<void> {
  const tree = document.querySelector('[role="tree"]');
  const folder = document.createElement('li');
  const group = document.createElement('ul');
  folder.id = 'src';
  folder.setAttribute('role', 'treeitem');
  folder.setAttribute('aria-expanded', 'true');
  group.setAttribute('role', 'group');
  for (const path of ['src/app.ts', 'src/new.ts', 'src/generated.ts']) {
    const item = document.getElementById(path);
    if (item) group.append(item);
  }
  folder.append(group);
  tree?.prepend(folder);
  openMenu();
  const app = await reviewApp({
    ...metadataSource('src/** group=Code'),
  });

  await nextReconcile(() => {
    for (const path of ['diff-app', 'diff-new', 'diff-generated']) {
      const button = document.querySelector<HTMLButtonElement>(
        `#${path} button[aria-label="Not Viewed"]`,
      );
      button?.setAttribute('aria-label', 'Viewed');
      button?.setAttribute('aria-pressed', 'true');
    }
  });
  await nextReconcile(() => {
    folder.setAttribute('aria-expanded', 'false');
    group.remove();
  });

  await until(() => {
    expect(folder.hidden).toBe(false);
    expect(
      document.querySelector(
        '.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="Code"]) .diffseek-menu-count',
      )?.textContent,
    ).toContain('3');
    expect(
      document
        .querySelector(
          '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
        )
        ?.getAttribute('aria-label'),
    ).toBe('Unmark all');
  });

  await nextReconcile(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Viewed"]',
    );
    button?.setAttribute('aria-label', 'Not Viewed');
    button?.setAttribute('aria-pressed', 'false');
  });
  await until(() => {
    expect(
      document
        .querySelector(
          '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
        )
        ?.getAttribute('aria-label'),
    ).toBe('Mark the rest viewed');
    expect(
      document
        .querySelector(
          '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
        )
        ?.getAttribute('aria-pressed'),
    ).toBe('mixed');
  });
  app.stop();
}

async function keepsPRHeadMetadataWhenTheDefaultBranchCacheWriteFails(): Promise<void> {
  const setSpy = vi
    .spyOn(fakeBrowser.storage.local, 'set')
    .mockRejectedValueOnce(new Error('storage unavailable'));
  const { app, readPull } = await openCachedPull(() => Promise.resolve({
    changed: true,
    metadata: {
      attributes: 'src/** group=default',
      codeowners: '',
    },
  }));

  await until(() => { expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(); },
  );
  await until(() => {
    expect(setSpy).toHaveBeenCalledWith({
      'diffseek:metadata:octo/repo': {
        attributes: 'src/** group=default',
        codeowners: '',
        version: 2,
      },
    });
  });
  expect(readPull).toHaveBeenCalledWith(
    expect.objectContaining({ pull: 1 }),
    { attributes: 'src/** group=cached', codeowners: '' },
  );
  expect(document.querySelector('[data-filter-value="default"]')).toBeNull();
  setSpy.mockRestore();
  app.stop();
}

async function leavesSignedOutVisitorsOnTheClassicRoute(): Promise<void> {
  const meta = document.createElement('meta');
  meta.name = 'user-login';
  meta.content = '';
  document.head.append(meta);
  const replace = vi.fn<(url: string) => void>();
  const app = await startReviewApp({
    pathname: () => '/octo/repo/pull/1/files',
    replace,
  });

  expect(replace).not.toHaveBeenCalled();

  app.stop();
}

async function openCachedPull(refreshDefault: DefaultRefresher): Promise<{
  app: ReviewApp;
  readPull: ReturnType<typeof vi.fn<PullReader>>;
}> {
  openMenu();
  const readPull = vi.fn<PullReader>().mockResolvedValue({
    attributes: 'src/** group=pull',
    codeowners: '',
  });
  const app = await reviewApp({
    readImmediate: () => Promise.resolve(cachedMetadata()),
    readPull: signalled(readPull),
    refreshDefault,
  });
  return { app, readPull };
}

async function reCollapsesAFilteredFileAfterGitHubExpandsIt(): Promise<void> {
  const app = await reviewApp({
    ...metadataSource('src/** group=Code'),
  });
  openMenu();
  const codeFilter = '[data-filter-kind="groups"][data-filter-value="Code"]';
  await until(() => { expect(document.querySelector(codeFilter)).not.toBeNull(); });
  document.querySelector<HTMLElement>(codeFilter)?.click();
  await until(() => { expect(
      document.querySelector('#diff-app button[aria-label="Expand file"]'),
    ).not.toBeNull(); },
  );
  document
    .querySelector<HTMLButtonElement>('#diff-app button[aria-label="Expand file"]')
    ?.setAttribute('aria-label', 'Collapse file');
  await until(() => { expect(document.querySelector('#diff-app button')?.getAttribute('aria-label')).toBe(
      'Expand file',
    ); },
  );
  app.stop();
}

async function reconcilesMenuRecreationFilteringAndAReplacedTree(): Promise<void> {
  const app = await reviewApp({
    ...metadataSource('src/** group=Code'),
  });

  await nextReconcile(openMenu);
  const codeFilter = document.querySelector<HTMLElement>(
    '[data-filter-kind="groups"][data-filter-value="Code"]',
  );
  codeFilter?.focus();
  codeFilter?.click();
  expect(document.getElementById('src/app.ts')?.hidden).toBe(true);
  expect(document.activeElement).toMatchObject({
    dataset: {
      filterKind: 'groups',
      filterValue: 'Code',
    },
  });

  const menu = document.querySelector('[role="menu"]');
  await nextReconcile(() => {
    menu?.remove();
    openMenu();
  });
  expect(document.querySelectorAll('[data-diffseek="filters"]')).toHaveLength(1);
  expect(
    document.querySelector('[data-filter-value="Code"]')?.getAttribute('aria-checked'),
  ).toBe('false');

  await nextReconcile(() => {
    const source = document.querySelector('[role="tree"]');
    source?.replaceWith(source.cloneNode(true));
  });
  expect(document.getElementById('src/app.ts')?.hidden).toBe(true);
  app.stop();
}

async function replacesCachedMetadataWithPRHeadContentWhileDefaultRefreshStaysIsolated(): Promise<void> {
  openMenu();
  const defaultRefresh = Promise.withResolvers<{
    changed: boolean;
    metadata: { attributes: string; codeowners: string };
  }>();
  const pullRead = Promise.withResolvers<{ attributes: string; codeowners: string }>();
  const refreshDefault = vi.fn<DefaultRefresher>(() => defaultRefresh.promise);
  const readPull = vi.fn<PullReader>(() => pullRead.promise);
  const app = await reviewApp({
    readImmediate: () => Promise.resolve({
      attributes: 'src/** group=cached',
      codeowners: '',
    }),
    readPull: signalled(readPull),
    refreshDefault: signalled(refreshDefault),
  });

  expect(document.querySelector('[data-filter-value="cached"]')).not.toBeNull();
  expect(readPull).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pull: 1 }), { attributes: 'src/** group=cached', codeowners: '' });
  expect(refreshDefault).toHaveBeenCalledExactlyOnceWith(pullReview);
  pullRead.resolve({
    attributes: 'src/** group=pull',
    codeowners: '',
  });
  await until(() => { expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(); },
  );
  await until(() => { expect(refreshDefault).toHaveBeenCalledExactlyOnceWith(pullReview); });
  defaultRefresh.resolve({
    changed: true,
    metadata: {
      attributes: 'src/** group=default',
      codeowners: '',
    },
  });
  await until(async () => {
    const stored = await fakeBrowser.storage.local.get(
      'diffseek:metadata:octo/repo',
    );
    expect(stored['diffseek:metadata:octo/repo']).toMatchObject({
      attributes: 'src/** group=default',
    });
  });
  expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull();
  expect(document.querySelector('[data-filter-value="default"]')).toBeNull();
  expect(document.querySelector('[data-filter-value="cached"]')).toBeNull();
  app.stop();
}

async function replacesTheClassicReviewRouteBeforeStartingASession(): Promise<void> {
  const replace = vi.fn<(url: string) => void>();
  const readImmediate = vi.fn<ImmediateReader>();
  const app = await startReviewApp({
    hash: () => '#diff-one',
    pathname: () => '/octo/repo/pull/1/files',
    readImmediate,
    replace,
  });

  expect(replace).toHaveBeenCalledWith(
    '/octo/repo/pull/1/changes?new_files_changed=true#diff-one',
  );
  expect(readImmediate).not.toHaveBeenCalled();

  app.reconcile();
  app.stop();
}

async function staysOnTheClassicRouteGitHubSentTheVisitorBackTo(): Promise<void> {
  const replace = vi.fn<(url: string) => void>();
  const app = await startReviewApp({
    pathname: () => '/octo/repo/pull/1/files',
    replace,
    search: () => '?new_files_changed=true',
  });

  expect(replace).not.toHaveBeenCalled();

  app.stop();
}
