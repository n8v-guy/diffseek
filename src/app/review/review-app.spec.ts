import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';
import type { PageSnapshot } from '@diffseek/github/review-page/page-adapter';

import { startReviewApp } from './review-app';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

const emptyMetadata = { codeowners: '', attributes: '' };
const inertMetadata = {
  readImmediate: async () => emptyMetadata,
  refreshDefault: async () => ({
    metadata: emptyMetadata,
    changed: false,
  }),
  readPull: async (
    _review: unknown,
    fallback: typeof emptyMetadata,
  ) => fallback,
};

function installNativeBehavior(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Collapse file"], button[aria-label="Expand file"]',
  )) {
    button.addEventListener('click', () => {
      button.setAttribute(
        'aria-label',
        button.getAttribute('aria-label') === 'Collapse file'
          ? 'Expand file'
          : 'Collapse file',
      );
    });
  }
}

function openMenu(): void {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<ul role="menu" aria-label="Filter options"><li role="menuitem">Native</li></ul>',
  );
}

async function nextReconcile(action: () => void): Promise<void> {
  const ready = new Promise<void>((resolve) => {
    document.addEventListener('diffseek-reconciled', () => resolve(), {
      once: true,
    });
  });
  action();
  await ready;
}

beforeEach(async () => {
  fakeBrowser.reset();
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': { hidden: [], viewed: [] },
  });
  document.documentElement.innerHTML = fixture;
  installNativeBehavior();
});

describe('review app lifecycle', () => {
  it('replaces the classic review route before starting a session', async () => {
    const replace = vi.fn();
    const readImmediate = vi.fn();
    const app = await startReviewApp({
      pathname: () => '/octo/repo/pull/1/files',
      hash: () => '#diff-one',
      replace,
      readImmediate,
    });

    expect(replace).toHaveBeenCalledWith(
      '/octo/repo/pull/1/changes?new_files_changed=true#diff-one',
    );
    expect(readImmediate).not.toHaveBeenCalled();

    app.reconcile();
    app.stop();
  });

  it('replaces cached metadata with PR-head content while default refresh stays isolated', async () => {
    openMenu();
    let resolveDefault:
      | ((value: {
          metadata: { codeowners: string; attributes: string };
          changed: boolean;
        }) => void)
      | undefined;
    let resolvePull:
      | ((value: { codeowners: string; attributes: string }) => void)
      | undefined;
    const refreshDefault = vi.fn(
      () =>
        new Promise<{
          metadata: { codeowners: string; attributes: string };
          changed: boolean;
        }>((resolve) => {
          resolveDefault = resolve;
        }),
    );
    const readPull = vi.fn(
      () =>
        new Promise<{ codeowners: string; attributes: string }>((resolve) => {
          resolvePull = resolve;
        }),
    );
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=cached',
      }),
      refreshDefault,
      readPull,
    });

    expect(document.querySelector('[data-filter-value="cached"]')).not.toBeNull();
    expect(readPull).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pull: 1 }), { codeowners: '', attributes: 'src/** group=cached' });
    expect(refreshDefault).toHaveBeenCalledOnce();
    resolvePull?.({
      codeowners: '',
      attributes: 'src/** group=pull',
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(),
    );
    await vi.waitFor(() => expect(refreshDefault).toHaveBeenCalledOnce());
    resolveDefault?.({
      metadata: {
        codeowners: '',
        attributes: 'src/** group=default',
      },
      changed: true,
    });
    await vi.waitFor(async () => {
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
  });

  it('continues to PR-head metadata when the default refresh fails', async () => {
    openMenu();
    const readPull = vi.fn().mockResolvedValue({
      codeowners: '',
      attributes: 'src/** group=pull',
    });
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=cached',
      }),
      refreshDefault: async () => {
        throw new Error('default unavailable');
      },
      readPull,
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(),
    );
    expect(readPull).toHaveBeenCalledWith(
      expect.objectContaining({ pull: 1 }),
      { codeowners: '', attributes: 'src/** group=cached' },
    );
    app.stop();
  });

  it('keeps PR-head metadata when the default-branch cache write fails', async () => {
    openMenu();
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const readPull = vi.fn().mockResolvedValue({
      codeowners: '',
      attributes: 'src/** group=pull',
    });
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=cached',
      }),
      refreshDefault: async () => ({
        metadata: {
          codeowners: '',
          attributes: 'src/** group=default',
        },
        changed: true,
      }),
      readPull,
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(),
    );
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalled());
    expect(readPull).toHaveBeenCalledWith(
      expect.objectContaining({ pull: 1 }),
      { codeowners: '', attributes: 'src/** group=cached' },
    );
    expect(document.querySelector('[data-filter-value="default"]')).toBeNull();
    setSpy.mockRestore();
    app.stop();
  });

  it('adopts default-branch attributes when the pull-head read keeps failing', async () => {
    await fakeBrowser.storage.local.clear();
    openMenu();
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'docs/** group=Docs',
      }),
      readPull: async () => {
        throw new Error('offline');
      },
      refreshDefault: async () => ({
        metadata: {
          codeowners: '',
          attributes: 'src/generated.ts linguist-generated',
        },
        changed: true,
      }),
    });

    await vi.waitFor(() =>
      expect(
        document
          .querySelector(
            '[data-filter-kind="generated"][data-filter-value="true"]',
          )
          ?.getAttribute('aria-checked'),
      ).toBe('mixed'),
    );
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
    app.stop();
  });

  it('classifies immediately from cached metadata and mounts ephemeral UI once', async () => {
    openMenu();
    const refreshDefault = vi.fn().mockResolvedValue({
      metadata: {
        codeowners: '*.ts @cached',
        attributes: 'src/** group=Code',
      },
      changed: false,
    });
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '*.ts @cached',
        attributes: 'src/** group=Code',
      }),
      refreshDefault,
    });

    const filters = document.querySelector('[data-diffseek="filters"]');
    expect(filters).not.toBeNull();
    expect(document.body.textContent).toContain('Code');
    expect(document.body.textContent).toContain('@cached');
    expect(document.querySelectorAll('[data-diffseek-viewed-action]')).toHaveLength(5);
    expect(refreshDefault).toHaveBeenCalledOnce();

    app.reconcile();
    expect(document.querySelector('[data-diffseek="filters"]')).toBe(filters);
    expect(document.querySelectorAll('[data-diffseek-viewed-action]')).toHaveLength(5);
    app.stop();
  });

  it('reconciles menu recreation, filtering, and a replaced tree', async () => {
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=Code',
      }),
      refreshDefault: async () => ({
        metadata: {
          codeowners: '',
          attributes: 'src/** group=Code',
        },
        changed: false,
      }),
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
      const replacement = document
        .querySelector('[role="tree"]')
        ?.cloneNode(true);
      document.querySelector('[role="tree"]')?.replaceWith(replacement!);
    });
    expect(document.getElementById('src/app.ts')?.hidden).toBe(true);
    app.stop();
  });

  it('re-collapses a filtered file after GitHub expands it', async () => {
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=Code',
      }),
      refreshDefault: async () => ({
        metadata: { codeowners: '', attributes: 'src/** group=Code' },
        changed: false,
      }),
    });
    await nextReconcile(openMenu);
    document
      .querySelector<HTMLElement>(
        '[data-filter-kind="groups"][data-filter-value="Code"]',
      )
      ?.click();
    const button = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Expand file"]',
    );
    expect(button).not.toBeNull();
    button?.setAttribute('aria-label', 'Collapse file');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('#diff-app button')?.getAttribute('aria-label')).toBe(
      'Expand file',
    );
    app.stop();
  });

  it('keeps a collapsed folder and its known files in the review session', async () => {
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
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=Code',
      }),
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
    ).toBe('Mark as not viewed');

    await nextReconcile(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '#diff-app button[aria-label="Viewed"]',
      );
      button?.setAttribute('aria-label', 'Not Viewed');
      button?.setAttribute('aria-pressed', 'false');
    });
    expect(
      document
        .querySelector(
          '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
        )
        ?.getAttribute('aria-label'),
    ).toBe('Mark 1 remaining in Code as viewed (2 of 3 viewed)');
    expect(
      document
        .querySelector(
          '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
        )
        ?.getAttribute('aria-pressed'),
    ).toBe('mixed');
    app.stop();
  });

  it('cleans up on partial navigation and extension invalidation', async () => {
    let path = '/octo/repo/pull/1/changes';
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
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
  });

  it('activates after partial navigation into a review', async () => {
    let path = '/octo/repo/issues/1';
    document.body.innerHTML = '<main>Issue</main>';
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => path,
    });

    await nextReconcile(() => {
      path = '/octo/repo/pull/1/changes';
      document.body.innerHTML = new DOMParser().parseFromString(
        fixture,
        'text/html',
      ).body.innerHTML;
      installNativeBehavior();
      openMenu();
    });
    expect(document.querySelector('[data-diffseek="filters"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-diffseek-viewed-action]')).toHaveLength(5);
    app.stop();
  });
});

describe('metadata refresh', () => {
  const immediate = { codeowners: '', attributes: 'docs/** group=Docs' };
  const loaded = { codeowners: '', attributes: 'src/generated.ts linguist-generated' };

  it('retries a failed read when the filter menu opens and then applies it', async () => {
    await fakeBrowser.storage.local.clear();
    const failed = Promise.reject(new Error('offline'));
    void failed.catch(() => undefined);
    const readPull = vi.fn()
      .mockReturnValueOnce(failed)
      .mockResolvedValueOnce(loaded);
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => immediate,
      refreshDefault: async () => ({ metadata: immediate, changed: false }),
      readPull,
    });
    await vi.waitFor(() => expect(readPull).toHaveBeenCalledOnce());
    await failed.catch(() => undefined);
    expect(document.querySelector('[data-filter-kind="generated"]')).toBeNull();

    openMenu();
    app.reconcile();
    await vi.waitFor(() => expect(readPull).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-filter-kind="generated"][data-filter-value="true"]')?.getAttribute('aria-checked'),
      ).toBe('mixed'),
    );
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
    app.stop();
  });

  it('retries a failed read when the file tree changes', async () => {
    const failed = Promise.reject(new Error('offline'));
    void failed.catch(() => undefined);
    const readPull = vi.fn()
      .mockReturnValueOnce(failed)
      .mockResolvedValueOnce(loaded);
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => immediate,
      refreshDefault: async () => ({ metadata: immediate, changed: false }),
      readPull,
    });
    await vi.waitFor(() => expect(readPull).toHaveBeenCalledOnce());
    await failed.catch(() => undefined);

    await nextReconcile(() => {
      const item = document.createElement('li');
      item.id = 'src/extra.ts';
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-label', 'extra.ts');
      document.querySelector('[role="tree"]')?.append(item);
    });
    await vi.waitFor(() => expect(readPull).toHaveBeenCalledTimes(2));
    openMenu();
    app.reconcile();
    expect(readPull).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-filter-kind="generated"]')).not.toBeNull(),
    );
    app.stop();
  });

  it('does not start another metadata read while one is in flight', async () => {
    let resolvePull: (value: typeof loaded) => void = () => undefined;
    const readPull = vi.fn(
      () => new Promise<typeof loaded>((resolve) => { resolvePull = resolve; }),
    );
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => immediate,
      refreshDefault: async () => ({ metadata: immediate, changed: false }),
      readPull,
    });
    await vi.waitFor(() => expect(readPull).toHaveBeenCalledOnce());
    openMenu();
    app.reconcile();
    document.querySelector('[role="tree"]')?.append(document.createElement('li'));
    app.reconcile();
    expect(readPull).toHaveBeenCalledOnce();

    resolvePull(loaded);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-filter-kind="generated"]')).not.toBeNull(),
    );
    expect(readPull).toHaveBeenCalledOnce();
    app.stop();
  });

  it('keeps cached metadata when the pull-head read fails', async () => {
    openMenu();
    const readPull = vi.fn(async () => {
      throw new Error('offline');
    });
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({ codeowners: '', attributes: 'src/** group=FromCache' }),
      refreshDefault: async () => ({
        metadata: { codeowners: '', attributes: 'src/** group=FromCache' },
        changed: false,
      }),
      readPull,
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-filter-value="FromCache"]')).not.toBeNull(),
    );
    expect(readPull).toHaveBeenCalledOnce();
    app.reconcile();
    expect(readPull).toHaveBeenCalledOnce();
    app.stop();
  });
});

describe('review app reuse invariants', () => {
  it('keeps classifications after a structure-key rescan', async () => {
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated\nsrc/** group=Code',
      }),
    });

    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-filter-kind="generated"][data-filter-value="true"]',
        ),
      ).not.toBeNull(),
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
  });

  it('recovers mutation scheduling after default mark-viewed rejects', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:filter-defaults': {
        hidden: ['generated'],
        viewed: ['generated'],
      },
    });
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      markFiles: vi.fn(async () => {
        throw new Error('native mark failed');
      }),
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated',
      }),
    });

    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-filter-kind="generated"][data-filter-value="true"]',
        )?.disabled,
      ).toBe(false),
    );

    await nextReconcile(() => {
      document
        .querySelector('#diff-app button[aria-label="Not Viewed"]')
        ?.setAttribute('aria-pressed', 'true');
      document
        .querySelector('#diff-app button[aria-label="Not Viewed"]')
        ?.setAttribute('aria-label', 'Viewed');
    });

    await vi.waitFor(() =>
      expect(
        document
          .querySelector<HTMLButtonElement>(
            '#src\\/app\\.ts [data-diffseek-viewed-action]',
          )
          ?.getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    app.stop();
  });

  it('repairs an owned menu after GitHub replaces its children', async () => {
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-diffseek="filters"]')).not.toBeNull(),
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Filter options"]',
    );
    expect(menu?.dataset.diffseekMenuOwned).toBe('true');

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
          child.dataset.diffseek !== 'filters' &&
          !child.hidden,
      ),
    ).toBe(false);
    app.stop();
  });
});

describe('fresh filter defaults', () => {
  it('hides generated and viewed files until they are shown again', async () => {
    await fakeBrowser.storage.local.clear();
    openMenu();
    const markFiles = vi.fn(async () => ({
      requested: 1,
      completed: ['src/generated.ts'],
      failed: [],
    }));
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      markFiles,
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated',
      }),
    });

    const viewed = () =>
      document.querySelector<HTMLButtonElement>(
        '[data-filter-kind="viewed"][data-filter-value="true"]',
      );
    const generated = () =>
      document.querySelector<HTMLButtonElement>(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      );
    const count = (facet: string) =>
      document.querySelector(
        `.diffseek-menu-row:has([data-filter-kind="${facet}"][data-filter-value="true"]) .diffseek-menu-count`,
      )?.textContent;

    await vi.waitFor(() =>
      expect(generated()?.getAttribute('aria-checked')).toBe('mixed'),
    );
    expect(viewed()?.getAttribute('aria-checked')).toBe('mixed');
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
    expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
    expect(count('viewed')).toBe('0/1');
    expect(count('generated')).toBe('0/1');
    expect(
      (await fakeBrowser.storage.local.get('diffseek:filter-defaults'))[
        'diffseek:filter-defaults'
      ],
    ).toBeUndefined();

    viewed()?.click();
    await vi.waitFor(() =>
      expect(document.getElementById('docs/readme.md')?.hidden).toBe(false),
    );
    expect(viewed()?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);

    generated()?.click();
    await vi.waitFor(() => {
      expect(generated()?.getAttribute('aria-checked')).toBe('true');
      expect(document.getElementById('src/generated.ts')?.hidden).toBe(false);
    });
    expect(
      document
        .querySelector('[data-diffseek-always-read]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(markFiles).not.toHaveBeenCalled();

    generated()?.click();
    generated()?.click();
    generated()?.click();
    await vi.waitFor(() =>
      expect(generated()?.getAttribute('aria-checked')).toBe('true'),
    );
    expect(markFiles).not.toHaveBeenCalled();
    await vi.waitFor(async () =>
      expect(
        await fakeBrowser.storage.local.get('diffseek:filter-defaults'),
      ).toEqual({
        'diffseek:filter-defaults': { hidden: [], viewed: [] },
      }),
    );
    app.stop();
  });

  it('respects a saved preference that hides only viewed files', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:filter-defaults': { hidden: ['viewed'], viewed: [] },
    });
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated',
      }),
    });

    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-filter-kind="generated"][data-filter-value="true"]',
        )?.getAttribute('aria-checked'),
      ).toBe('true'),
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
  });
});

describe('review app interactions', () => {
  it('hides and marks generated files viewed from the persisted default', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:filter-defaults': {
        hidden: ['generated'],
        viewed: ['generated'],
      },
    });
    let releaseMark!: () => void;
    const markGate = new Promise<void>((resolve) => {
      releaseMark = resolve;
    });
    const markFiles = vi.fn(async (
      snapshot: SupportedSnapshot,
      paths: string[],
      viewed: boolean,
    ) => {
      await markGate;
      for (const path of paths) {
        const control = snapshot.viewedControl(path);
        control?.setAttribute('aria-label', viewed ? 'Viewed' : 'Not Viewed');
        control?.setAttribute('aria-pressed', String(viewed));
      }
      return { requested: paths.length, completed: paths, failed: [] };
    });
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      markFiles,
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated',
      }),
    });

    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-filter-kind="generated"][data-filter-value="true"]',
        )?.disabled,
      ).toBe(true),
    );
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
    expect(
      document
        .querySelector('[data-diffseek-always-read]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    await vi.waitFor(() =>
      expect(markFiles).toHaveBeenCalledWith(
        expect.anything(),
        ['src/generated.ts'],
        true,
        expect.anything(),
      ),
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

    releaseMark();
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '#diff-generated button[aria-label="Viewed"]',
        ),
      ).not.toBeNull(),
    );
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-filter-kind="generated"][data-filter-value="true"]',
        )?.disabled,
      ).toBe(false),
    );

    document
      .querySelector<HTMLButtonElement>(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )
      ?.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"][data-viewed-value="true"]',
        )?.getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    app.stop();
  });

  it('marks generated files when auto-view turns on and stops when it turns off', async () => {
    const markFiles = vi.fn(async (snapshot: SupportedSnapshot, paths: string[], viewed: boolean) => {
      for (const path of paths) {
        snapshot.viewedControl(path)?.setAttribute('aria-label', viewed ? 'Viewed' : 'Not Viewed');
        snapshot.viewedControl(path)?.setAttribute('aria-pressed', String(viewed));
      }
      return { requested: paths.length, completed: paths, failed: [] };
    });
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      markFiles,
      readImmediate: async () => ({ codeowners: '', attributes: 'src/generated.ts linguist-generated' }),
    });
    const alwaysRead = () => document.querySelector<HTMLButtonElement>('[data-diffseek-always-read]');
    await vi.waitFor(() => expect(alwaysRead()).not.toBeNull());
    alwaysRead()?.click();
    await vi.waitFor(() => expect(markFiles).toHaveBeenCalledWith(expect.anything(), ['src/generated.ts'], true, expect.anything()));
    expect(alwaysRead()?.getAttribute('aria-pressed')).toBe('true');
    alwaysRead()?.click();
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get('diffseek:filter-defaults')).toEqual({
      'diffseek:filter-defaults': { hidden: [], viewed: [] },
    }));
    const control = document.querySelector('#diff-generated button');
    control?.setAttribute('aria-label', 'Not Viewed');
    control?.setAttribute('aria-pressed', 'false');
    app.reconcile();
    expect(control?.getAttribute('aria-label')).toBe('Not Viewed');
    expect(markFiles).toHaveBeenCalledTimes(1);
    app.stop();
  });

  it('applies and updates extension-wide remembered filter defaults', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:filter-defaults': { hidden: ['viewed'] },
    });
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
    });

    const viewed = document.querySelector<HTMLButtonElement>(
      '[data-filter-kind="viewed"][data-filter-value="true"]',
    );
    expect(viewed?.getAttribute('aria-checked')).toBe('mixed');
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);

    viewed?.click();
    await vi.waitFor(async () =>
      expect(
        await fakeBrowser.storage.local.get('diffseek:filter-defaults'),
      ).toEqual({
        'diffseek:filter-defaults': { hidden: [], viewed: [] },
      }),
    );
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(false);
    expect(
      [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)
        ?.textContent,
    ).toBe('Show now');

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
    await vi.waitFor(async () =>
      expect(
        await fakeBrowser.storage.local.get('diffseek:filter-defaults'),
      ).toEqual({
        'diffseek:filter-defaults': {
          hidden: ['viewed'],
          viewed: [],
        },
      }),
    );
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-filter-kind="viewed"][data-filter-value="true"]',
      )?.getAttribute('aria-checked'),
    ).toBe('mixed');
    expect(
      [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)
        ?.textContent,
    ).toBe('Always hide');
    app.stop();
  });

  it('reports a partial viewed-action failure without retrying', async () => {
    const filterButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter options"]',
    );
    filterButton?.removeAttribute('aria-label');
    filterButton?.setAttribute('aria-labelledby', 'filter-options-label');
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<span id="filter-options-label">Filter options</span>',
    );
    const markFiles = vi.fn().mockResolvedValue({
      requested: 1,
      completed: [],
      failed: [
        {
          path: 'src/app.ts',
          reason: 'GitHub did not confirm viewed state',
        },
      ],
    });
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      markFiles,
    });

    document
      .querySelector<HTMLElement>(
        '#src\\/app\\.ts [data-diffseek-viewed-action]',
      )
      ?.click();

    await vi.waitFor(() => {
      expect(
        [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)
          ?.textContent,
      ).toBe('Marked 0 files as viewed; 1 failed');
    });
    expect(markFiles).toHaveBeenCalledOnce();
    app.stop();
  });

  it('suppresses a batch result from an earlier pull request', async () => {
    let path = '/octo/repo/pull/1/changes';
    let finishBatch:
      | ((result: {
          requested: number;
          completed: string[];
          failed: Array<{ path: string; reason: string }>;
        }) => void)
      | undefined;
    const markFiles = vi.fn(
      () =>
        new Promise<{
          requested: number;
          completed: string[];
          failed: Array<{ path: string; reason: string }>;
        }>((resolve) => {
          finishBatch = resolve;
        }),
    );
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => path,
      markFiles,
    });

    document
      .querySelector<HTMLButtonElement>(
        '#src\\/app\\.ts [data-diffseek-viewed-action]',
      )
      ?.click();
    await vi.waitFor(() => expect(markFiles).toHaveBeenCalledOnce());

    await nextReconcile(() => {
      path = '/octo/repo/pull/2/changes';
      document.body.append(document.createElement('span'));
    });
    finishBatch?.({
      requested: 1,
      completed: [],
      failed: [{ path: 'src/app.ts', reason: 'stale' }],
    });
    await Promise.resolve();

    expect(
      document.querySelector('[data-diffseek="snackbars"]'),
    ).toBeNull();
    app.stop();
  });

  it('starts a new pull request with no inherited filter selection', async () => {
    let path = '/octo/repo/pull/1/changes';
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => path,
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=Code',
      }),
      refreshDefault: async () => ({
        metadata: {
          codeowners: '',
          attributes: 'src/** group=Code',
        },
        changed: false,
      }),
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
  });

  it('rolls back presentation when GitHub contracts disappear', async () => {
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=Code',
      }),
      refreshDefault: async () => ({
        metadata: {
          codeowners: '',
          attributes: 'src/** group=Code',
        },
        changed: false,
      }),
    });
    document
      .querySelector<HTMLButtonElement>('[data-filter-value="Code"]')
      ?.click();
    expect(
      document.getElementById('diff-app')?.dataset.diffseekFilteredOut,
    ).toBe('true');

    await nextReconcile(() => {
      document.querySelector('[role="tree"]')?.remove();
    });

    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBeUndefined();
    expect(
      document.querySelector('#diff-config button')?.getAttribute('aria-label'),
    ).toBe('Collapse file');
    expect(
      document.querySelector('[data-diffseek="unavailable"]')?.textContent,
    ).toContain('File tree is unavailable');
    app.stop();
  });

  it('reconciles a native viewed state changed only through attributes', async () => {
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
    });
    const viewed = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Not Viewed"]',
    );
    viewed?.setAttribute('aria-label', 'Viewed');
    viewed?.setAttribute('aria-pressed', 'true');

    await vi.waitFor(() => {
      expect(
        document
          .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
          ?.getAttribute('aria-label'),
      ).toBe('Mark as not viewed');
    });
    app.stop();
  });

  it('keeps attribute-generated labels after GitHub loads the diff', async () => {
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated',
      }),
      refreshDefault: async () => ({
        metadata: {
          codeowners: '',
          attributes: 'src/generated.ts linguist-generated',
        },
        changed: false,
      }),
    });
    document
      .querySelector<HTMLButtonElement>(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )
      ?.click();
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);

    await nextReconcile(() => {
      const region = document.getElementById('diff-generated');
      [...(region?.querySelectorAll('button, p') ?? [])]
        .filter(
          (element) =>
            element.textContent?.trim() === 'Load Diff' ||
            element.textContent?.includes(
              'Some generated files are not rendered by default',
            ),
        )
        .forEach((element) => element.remove());
      if (!region) return;
      region.replaceWith(region.cloneNode(true));
    });

    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
    app.stop();
  });

  it('retains observed native owners across diff hydration', async () => {
    openMenu();
    const app = await startReviewApp({
      ...inertMetadata,
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
    });
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
  });
});
