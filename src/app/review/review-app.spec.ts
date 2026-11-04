import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { PageSnapshot } from '@diffseek/github';
import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';
import type {
  MetadataFiles,
  RepositoryMetadata,
} from '@diffseek/repository-metadata';

import type { DefaultMetadata } from '../metadata/reader';

import { startReviewApp } from './review-app';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

const emptyMetadata = { codeowners: '', attributes: '' };

function loadedDefault(
  metadata: RepositoryMetadata,
  changed = false,
  files: MetadataFiles = {},
): DefaultMetadata {
  return { metadata, cache: { files, refreshedAt: 0, pulls: [] }, changed };
}

const changesPath = '/octo/repo/pull/1/changes';

function metadataSource(attributes: string) {
  const metadata = { ...emptyMetadata, attributes };
  return {
    readImmediate: async () => metadata,
    refreshDefault: async () => loadedDefault(metadata),
  };
}

function reviewApp(
  extra: Partial<Parameters<typeof startReviewApp>[0]> = {},
  pathname: () => string = () => changesPath,
) {
  const readImmediate = extra.readImmediate ?? (async () => emptyMetadata);
  return startReviewApp({
    readImmediate,
    refreshDefault: async () => loadedDefault(await readImmediate({ owner: 'octo', repo: 'repo' })),
    readPull: async (_review, base) => base.metadata,
    root: document,
    pathname,
    ...extra,
  });
}

function marked(completed: string[]) {
  return vi.fn(async () => ({
    requested: completed.length,
    completed,
    failed: [] as string[],
  }));
}

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

function streamTreeItem(path: string): Promise<void> {
  return nextReconcile(() => {
    document.querySelector('[role="tree"]')?.insertAdjacentHTML('beforeend', `
      <li id="${path}" role="treeitem" aria-label="${path}">
        <div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-added"></svg></div>
        <a href="#diff-${path.replaceAll(/\W/g, '-')}">${path}</a>
      </li>`);
  });
}

const calls = new EventTarget();

/** Wraps an injected dependency so each call is an event `until` re-checks on. */
function signalled<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => {
    const result = fn(...args);
    calls.dispatchEvent(new Event('call'));
    return result;
  };
}

/**
 * Resolves once `check` stops throwing. Re-checks on DOM mutations, session
 * reconciles, injected-dependency calls, and extension storage changes instead
 * of polling; the timeout
 * only fails a wait whose event never comes.
 */
async function until(
  check: () => unknown,
  guardMs = 4_000,
): Promise<void> {
  let lastError: unknown;
  const passes = async () => {
    try {
      await check();
      return true;
    } catch (error) {
      lastError = error;
      return false;
    }
  };
  if (await passes()) return;
  await new Promise<void>((resolve, reject) => {
    let running = false;
    let rerun = false;
    let done = false;
    const finish = () => {
      done = true;
      observer.disconnect();
      document.removeEventListener('diffseek-reconciled', recheck);
      fakeBrowser.storage.onChanged.removeListener(recheck);
      calls.removeEventListener('call', recheck);
      clearTimeout(timer);
    };
    const recheck = () => {
      if (done) return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      void (async () => {
        do {
          rerun = false;
          if (await passes()) {
            finish();
            resolve();
            break;
          }
          // Assigned from the observer; a direct read is typed as a constant.
        } while (Object.is(rerun, true) && Object.is(done, false));
        running = false;
      })();
    };
    const observer = new MutationObserver(recheck);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    document.addEventListener('diffseek-reconciled', recheck);
    fakeBrowser.storage.onChanged.addListener(recheck);
    calls.addEventListener('call', recheck);
    const timer = setTimeout(() => {
      finish();
      reject(lastError instanceof Error ? lastError : new Error('until: condition never held'));
    }, guardMs);
    recheck();
  });
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

  it('stays on the classic route GitHub sent the visitor back to', async () => {
    const replace = vi.fn();
    const app = await startReviewApp({
      pathname: () => '/octo/repo/pull/1/files',
      search: () => '?new_files_changed=true',
      replace,
    });

    expect(replace).not.toHaveBeenCalled();

    app.stop();
  });

  it('leaves signed-out visitors on the classic route', async () => {
    const meta = document.createElement('meta');
    meta.name = 'user-login';
    meta.content = '';
    document.head.append(meta);
    const replace = vi.fn();
    const app = await startReviewApp({
      pathname: () => '/octo/repo/pull/1/files',
      replace,
    });

    expect(replace).not.toHaveBeenCalled();

    app.stop();
  });

  it('replaces cached metadata with the default branch and then the PR side', async () => {
    openMenu();
    const files = { 'web/.gitattributes': { blob: 'b', text: '' } };
    let resolveDefault = (_value: DefaultMetadata): void => undefined;
    let resolvePull = (_value: RepositoryMetadata): void => undefined;
    const refreshDefault = vi.fn(
      () => new Promise<DefaultMetadata>((resolve) => { resolveDefault = resolve; }),
    );
    const readPull = vi.fn(
      (_review: unknown, _base: DefaultMetadata) =>
        new Promise<RepositoryMetadata>((resolve) => { resolvePull = resolve; }),
    );
    const app = await reviewApp({
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=cached',
      }),
      refreshDefault: signalled(refreshDefault),
      readPull: signalled(readPull),
    });

    expect(document.querySelector('[data-filter-value="cached"]')).not.toBeNull();
    expect(readPull).not.toHaveBeenCalled();
    resolveDefault(loadedDefault({ codeowners: '', attributes: 'src/** group=default' }, true, files));
    await until(() => expect(readPull).toHaveBeenCalledOnce());
    expect(readPull.mock.calls[0]?.[1].cache.files).toEqual(files);
    expect(document.querySelector('[data-filter-value="default"]')).not.toBeNull();
    expect(document.querySelector('[data-filter-value="cached"]')).toBeNull();
    resolvePull({ codeowners: '', attributes: 'src/** group=pull' });
    await until(() =>
      expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(),
    );
    await until(async () => {
      const stored = await fakeBrowser.storage.local.get('diffseek:metadata:octo/repo');
      expect(stored['diffseek:metadata:octo/repo']).toMatchObject({ version: 3, files });
    });
    expect(document.querySelector('[data-filter-value="default"]')).toBeNull();
    expect(refreshDefault).toHaveBeenCalledOnce();
    app.stop();
  });

  it('keeps cached metadata and skips the PR side when the default read fails', async () => {
    openMenu();
    const readPull = vi.fn();
    const app = await reviewApp({
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=cached',
      }),
      refreshDefault: signalled(async () => {
        throw new Error('default unavailable');
      }),
      readPull,
    });

    await until(() =>
      expect(document.querySelector('[data-filter-value="cached"]')).not.toBeNull(),
    );
    expect(readPull).not.toHaveBeenCalled();
    app.stop();
  });

  it('applies the default branch and the PR side when the cache write fails', async () => {
    openMenu();
    const setSpy = vi
      .spyOn(fakeBrowser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const app = await reviewApp({
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/** group=cached',
      }),
      refreshDefault: async () =>
        loadedDefault({ codeowners: '', attributes: 'src/** group=default' }, true),
      readPull: async () => ({ codeowners: '', attributes: 'src/** group=pull' }),
    });

    await until(() => expect(setSpy).toHaveBeenCalled());
    await until(() =>
      expect(document.querySelector('[data-filter-value="pull"]')).not.toBeNull(),
    );
    setSpy.mockRestore();
    app.stop();
  });

  it('adopts default-branch attributes when the pull-head read keeps failing', async () => {
    await fakeBrowser.storage.local.clear();
    openMenu();
    const app = await reviewApp({
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'docs/** group=Docs',
      }),
      readPull: async () => {
        throw new Error('offline');
      },
      refreshDefault: async () =>
        loadedDefault(
          { codeowners: '', attributes: 'src/generated.ts linguist-generated' },
          true,
        ),
    });

    await until(() =>
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
    const refreshDefault = vi.fn().mockResolvedValue(
      loadedDefault({ codeowners: '*.ts @cached', attributes: 'src/** group=Code' }),
    );
    const app = await reviewApp({
      readImmediate: async () => ({
        codeowners: '*.ts @cached',
        attributes: 'src/** group=Code',
      }),
      refreshDefault: signalled(refreshDefault),
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
      const tree = document.querySelector('[role="tree"]');
      const replacement = tree?.cloneNode(true);
      if (tree != null && replacement != null) tree.replaceWith(replacement);
    });
    expect(document.getElementById('src/app.ts')?.hidden).toBe(true);
    app.stop();
  });

  it('re-collapses a filtered file after GitHub expands it', async () => {
    const app = await reviewApp({
      ...metadataSource('src/** group=Code'),
    });
    openMenu();
    const codeFilter = '[data-filter-kind="groups"][data-filter-value="Code"]';
    await until(() => expect(document.querySelector(codeFilter)).not.toBeNull());
    document.querySelector<HTMLElement>(codeFilter)?.click();
    await until(() =>
      expect(
        document.querySelector('#diff-app button[aria-label="Expand file"]'),
      ).not.toBeNull(),
    );
    document
      .querySelector<HTMLButtonElement>('#diff-app button[aria-label="Expand file"]')
      ?.setAttribute('aria-label', 'Collapse file');
    await until(() =>
      expect(document.querySelector('#diff-app button')?.getAttribute('aria-label')).toBe(
        'Expand file',
      ),
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
  });

  it('cleans up on partial navigation and extension invalidation', async () => {
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
  });

  it('activates after partial navigation into a review', async () => {
    let path = '/octo/repo/issues/1';
    document.body.innerHTML = '<main>Issue</main>';
    const app = await reviewApp({
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
    const app = await reviewApp({
      readImmediate: async () => immediate,
      refreshDefault: async () => loadedDefault(immediate),
      readPull: signalled(readPull),
    });
    await until(() => expect(readPull).toHaveBeenCalledOnce());
    await failed.catch(() => undefined);
    expect(document.querySelector('[data-filter-kind="generated"]')).toBeNull();

    openMenu();
    app.reconcile();
    await until(() => expect(readPull).toHaveBeenCalledTimes(2));
    await until(() =>
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
    const app = await reviewApp({
      readImmediate: async () => immediate,
      refreshDefault: async () => loadedDefault(immediate),
      readPull: signalled(readPull),
    });
    await until(() => expect(readPull).toHaveBeenCalledOnce());
    await failed.catch(() => undefined);

    await nextReconcile(() => {
      const item = document.createElement('li');
      item.id = 'src/extra.ts';
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-label', 'extra.ts');
      document.querySelector('[role="tree"]')?.append(item);
    });
    await until(() => expect(readPull).toHaveBeenCalledTimes(2));
    openMenu();
    app.reconcile();
    expect(readPull).toHaveBeenCalledTimes(2);
    await until(() =>
      expect(document.querySelector('[data-filter-kind="generated"]')).not.toBeNull(),
    );
    app.stop();
  });

  it('does not start another metadata read while one is in flight', async () => {
    let resolvePull = (_value: typeof loaded): void => undefined;
    const readPull = vi.fn(
      () => new Promise<typeof loaded>((resolve) => { resolvePull = resolve; }),
    );
    const app = await reviewApp({
      readImmediate: async () => immediate,
      refreshDefault: async () => loadedDefault(immediate),
      readPull: signalled(readPull),
    });
    await until(() => expect(readPull).toHaveBeenCalledOnce());
    openMenu();
    app.reconcile();
    document.querySelector('[role="tree"]')?.append(document.createElement('li'));
    app.reconcile();
    expect(readPull).toHaveBeenCalledOnce();

    resolvePull(loaded);
    await until(() =>
      expect(document.querySelector('[data-filter-kind="generated"]')).not.toBeNull(),
    );
    expect(readPull).toHaveBeenCalledOnce();
    app.stop();
  });

  it('reopens a settled read only for streamed paths that need an unloaded ancestor', async () => {
    const root = { blob: 'r', text: '' };
    const known = { '.gitattributes': root, 'web/.gitattributes': { blob: 'w' } };
    const fetched = { ...known, 'web/.gitattributes': { blob: 'w', text: 'web/** group=Web' } };
    const refreshDefault = vi.fn<(review: { paths: string[] }) => Promise<DefaultMetadata>>()
      .mockResolvedValueOnce(loadedDefault(immediate, true, known))
      .mockResolvedValueOnce(loadedDefault(immediate, true, fetched));
    const readPull = vi.fn(async (_review: unknown, base: DefaultMetadata) => base.metadata);
    const app = await reviewApp({
      readImmediate: async () => immediate,
      refreshDefault: signalled(refreshDefault),
      readPull: signalled(readPull),
    });
    await until(() => expect(readPull).toHaveBeenCalledOnce());

    await streamTreeItem('src/more.ts');
    await streamTreeItem('docs/more.md');
    expect(refreshDefault).toHaveBeenCalledOnce();
    expect(readPull).toHaveBeenCalledOnce();

    await streamTreeItem('web/page.ts');
    await until(() => expect(readPull).toHaveBeenCalledTimes(2));
    expect(refreshDefault.mock.lastCall?.[0].paths).toContain('web/page.ts');

    await streamTreeItem('web/other.ts');
    await streamTreeItem('src/last.ts');
    expect(refreshDefault).toHaveBeenCalledTimes(2);
    expect(readPull).toHaveBeenCalledTimes(2);
    app.stop();
  });

  it('reads the PR side again only when a streamed path is itself metadata', async () => {
    const refreshDefault = vi.fn().mockResolvedValue(loadedDefault(immediate));
    const readPull = vi.fn(async (_review: { paths: string[] }, base: DefaultMetadata) => base.metadata);
    const app = await reviewApp({
      readImmediate: async () => immediate,
      refreshDefault: signalled(refreshDefault),
      readPull: signalled(readPull),
    });
    await until(() => expect(readPull).toHaveBeenCalledOnce());

    await streamTreeItem('web/.gitattributes');
    await until(() => expect(readPull).toHaveBeenCalledTimes(2));
    expect(readPull.mock.lastCall?.[0].paths).toContain('web/.gitattributes');
    app.stop();
  });

  it('keeps cached metadata when the pull-head read fails', async () => {
    openMenu();
    const readPull = vi.fn(async () => {
      throw new Error('offline');
    });
    const app = await reviewApp({
      readImmediate: async () => ({ codeowners: '', attributes: 'src/** group=FromCache' }),
      refreshDefault: async () =>
        loadedDefault({ codeowners: '', attributes: 'src/** group=FromCache' }),
      readPull: signalled(readPull),
    });
    await until(() =>
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
    const app = await reviewApp({
      readImmediate: async () => ({
        codeowners: '',
        attributes: 'src/generated.ts linguist-generated\nsrc/** group=Code',
      }),
    });

    await until(() =>
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
    const app = await reviewApp({
      markFiles: vi.fn(async () => {
        throw new Error('native mark failed');
      }),
      ...metadataSource('src/generated.ts linguist-generated'),
    });

    await until(() =>
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

    await until(() =>
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
    const app = await reviewApp({
    });

    await until(() =>
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
          child.hidden === false,
      ),
    ).toBe(false);
    app.stop();
  });
});

describe('fresh filter defaults', () => {
  it('hides generated and viewed files and turns auto-view on for a fresh install', async () => {
    await fakeBrowser.storage.local.clear();
    openMenu();
    const markFiles = marked(['src/generated.ts']);
    const app = await reviewApp({
      markFiles: signalled(markFiles),
      ...metadataSource('src/generated.ts linguist-generated'),
    });

    await until(() =>
      expect(
        document
          .querySelector('[data-diffseek-always-read]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    await until(() =>
      expect(markFiles).toHaveBeenCalledWith(
        expect.anything(),
        ['src/generated.ts'],
        true,
        expect.anything(),
      ),
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
  });

  it('hides generated and viewed files until they are shown again', async () => {
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

    await until(() =>
      expect(generated()?.getAttribute('aria-checked')).toBe('mixed'),
    );
    expect(viewed()?.getAttribute('aria-checked')).toBe('mixed');
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);
    expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
    expect(count('viewed')).toBe('0/1');
    expect(count('generated')).toBe('0/1');

    viewed()?.click();
    await until(() =>
      expect(document.getElementById('docs/readme.md')?.hidden).toBe(false),
    );
    expect(viewed()?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(true);

    generated()?.click();
    await until(() => {
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
    await until(() =>
      expect(generated()?.getAttribute('aria-checked')).toBe('true'),
    );
    expect(markFiles).not.toHaveBeenCalled();
    await until(async () =>
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
    const app = await reviewApp({
      ...metadataSource('src/generated.ts linguist-generated'),
    });

    await until(() =>
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
  it('waits for nested exceptions before automatically marking files viewed', async () => {
    await fakeBrowser.storage.local.set({
      'diffseek:filter-defaults': { hidden: ['generated'], viewed: ['generated'] },
    });
    const root = { codeowners: '', attributes: 'src/** linguist-generated' };
    const loaded = {
      ...root,
      nestedAttributes: { src: 'generated.ts linguist-generated=false' },
    };
    const gate = Promise.withResolvers<typeof loaded>();
    const markFiles = vi.fn(async (_snapshot: SupportedSnapshot, paths: string[]) => ({
      requested: paths.length, completed: paths, failed: [],
    }));
    const app = await reviewApp({
      readImmediate: async () => root,
      readPull: () => gate.promise,
      markFiles: signalled(markFiles),
    });
    expect(document.querySelector('[data-diffseek="snackbar"]')).toBeNull();
    expect(markFiles).not.toHaveBeenCalled();

    gate.resolve(loaded);
    await until(() => expect(markFiles).toHaveBeenCalledTimes(2));
    expect(markFiles.mock.calls.flatMap(([, paths]) => paths))
      .toEqual(['src/app.ts', 'src/new.ts']);
    expect(document.getElementById('src/generated.ts')?.hidden).toBe(false);
    app.stop();
  });

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
    const app = await reviewApp({
      markFiles: signalled(markFiles),
      ...metadataSource('src/generated.ts linguist-generated'),
    });

    await until(() =>
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
    await until(() =>
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
    await until(() =>
      expect(
        document.querySelector(
          '#diff-generated button[aria-label="Viewed"]',
        ),
      ).not.toBeNull(),
    );
    await until(() =>
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
    await until(() =>
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
    const app = await reviewApp({
      markFiles: signalled(markFiles),
      ...metadataSource('src/generated.ts linguist-generated'),
    });
    const alwaysRead = () => document.querySelector<HTMLButtonElement>('[data-diffseek-always-read]');
    await until(() => expect(alwaysRead()).not.toBeNull());
    alwaysRead()?.click();
    await until(() => expect(markFiles).toHaveBeenCalledWith(expect.anything(), ['src/generated.ts'], true, expect.anything()));
    // The auto-view batch must finish before the toggle is clicked again.
    await until(() => {
      expect(document.querySelector('#diff-generated button[aria-label="Viewed"]')).not.toBeNull();
      expect(document.querySelector('[data-filter-kind="generated"][data-filter-value="true"]')?.hasAttribute('disabled')).toBe(false);
    });
    expect(alwaysRead()?.getAttribute('aria-pressed')).toBe('true');
    alwaysRead()?.click();
    await until(async () => expect(await fakeBrowser.storage.local.get('diffseek:filter-defaults')).toEqual({
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
    const app = await reviewApp({
    });

    const viewed = document.querySelector<HTMLButtonElement>(
      '[data-filter-kind="viewed"][data-filter-value="true"]',
    );
    expect(viewed?.getAttribute('aria-checked')).toBe('mixed');
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);

    viewed?.click();
    await until(async () =>
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
    await until(async () =>
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
    ).toBe('Always hidden');
    app.stop();
  });

  it('asks to try again after a failed viewed action without retrying', async () => {
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
      failed: ['src/app.ts'],
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
    expect(markFiles).toHaveBeenCalledOnce();
    app.stop();
  });

  it('suppresses a batch result from an earlier pull request', async () => {
    let path = '/octo/repo/pull/1/changes';
    let finishBatch:
      | ((result: {
          requested: number;
          completed: string[];
          failed: string[];
        }) => void)
      | undefined;
    const markFiles = vi.fn(
      () =>
        new Promise<{
          requested: number;
          completed: string[];
          failed: string[];
        }>((resolve) => {
          finishBatch = resolve;
        }),
    );
    const app = await reviewApp({
      pathname: () => path,
      markFiles: signalled(markFiles),
    });

    document
      .querySelector<HTMLButtonElement>(
        '#src\\/app\\.ts [data-diffseek-viewed-action]',
      )
      ?.click();
    await until(() => expect(markFiles).toHaveBeenCalledOnce());

    await nextReconcile(() => {
      path = '/octo/repo/pull/2/changes';
      document.body.append(document.createElement('span'));
    });
    finishBatch?.({
      requested: 1,
      completed: [],
      failed: ['src/app.ts'],
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
  });

  it('rolls back presentation when GitHub contracts disappear', async () => {
    openMenu();
    const app = await reviewApp({
      ...metadataSource('src/** group=Code'),
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
    ).toBe('DiffSeek unavailable. No file tree on this page');
    app.stop();
  });

  it('reconciles a native viewed state changed only through attributes', async () => {
    const app = await reviewApp({
    });
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
  });

  it('keeps attribute-generated labels after GitHub loads the diff', async () => {
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

    await nextReconcile(() => {
      const region = document.getElementById('diff-generated');
      [...(region?.querySelectorAll('button, p') ?? [])]
        .filter(
          (element) =>
            element.textContent.trim() === 'Load Diff' ||
            element.textContent.includes(
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
    const app = await reviewApp({
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
