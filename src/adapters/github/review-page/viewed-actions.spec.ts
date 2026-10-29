import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyFacetExclusions, ReviewIndex } from '@diffseek/review';

import fixture from './fixtures/github-pr.html?raw';
import { scanPage } from './page-adapter';
import {
  markViewed,
  mountViewedActions,
} from './viewed-actions';

describe('viewed actions', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
  });

  it('uses existing controls sequentially and verifies their state', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    for (const path of ['src/app.ts', 'src/new.ts']) {
      const button = snapshot.viewedControl(path);
      button?.addEventListener('click', () => {
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Viewed');
      });
    }

    const result = await markViewed(
      snapshot,
      ['src/app.ts', 'src/new.ts'],
      true,
      { timeoutMs: 20 },
    );

    expect(result).toEqual({
      requested: 2,
      completed: ['src/app.ts', 'src/new.ts'],
      failed: [],
    });
  });

  it('reports a control that GitHub does not confirm without retrying', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const button = snapshot.viewedControl('src/app.ts');
    const clicks = vi.fn();
    button?.addEventListener('click', clicks);

    const result = await markViewed(snapshot, ['src/app.ts'], true, {
      timeoutMs: 5,
    });

    expect(clicks).toHaveBeenCalledOnce();
    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([
      {
        path: 'src/app.ts',
        reason: 'GitHub did not confirm viewed state',
      },
    ]);
  });

  it('continues with supported files after a viewed control is unavailable', async () => {
    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.remove();
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const supported = snapshot.viewedControl('src/new.ts');
    supported?.addEventListener('click', () => {
      supported.setAttribute('aria-pressed', 'true');
      supported.setAttribute('aria-label', 'Viewed');
    });

    const result = await markViewed(
      snapshot,
      ['src/app.ts', 'src/new.ts'],
      true,
      { timeoutMs: 20 },
    );

    expect(result).toEqual({
      requested: 2,
      completed: ['src/new.ts'],
      failed: [
        {
          path: 'src/app.ts',
          reason: 'Viewed control is unavailable',
        },
      ],
    });
  });

  it('confirms state on the viewed control GitHub replaces after the click', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const button = snapshot.viewedControl('src/app.ts');
    button?.addEventListener('click', () => {
      const replacement = button.cloneNode(true) as HTMLButtonElement;
      replacement.setAttribute('aria-pressed', 'true');
      replacement.setAttribute('aria-label', 'Viewed');
      button.replaceWith(replacement);
    });

    const result = await markViewed(snapshot, ['src/app.ts'], true, {
      timeoutMs: 20,
    });

    expect(result.completed).toEqual(['src/app.ts']);
    expect(result.failed).toEqual([]);
  });

  it('confirms state when GitHub replaces the header wrapper after the click', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const button = snapshot.viewedControl('src/app.ts');
    button?.addEventListener('click', () => {
      const wrapper = button.closest('[data-diff-header-wrapper="true"]');
      const region = button.closest('[role="region"]');
      if (!wrapper || !region) throw new Error('Missing wrapper');
      const next = wrapper.cloneNode(true) as HTMLElement;
      const nextButton = next.querySelector<HTMLButtonElement>(
        'button[aria-label="Not Viewed"], button[aria-label="Viewed"]',
      );
      nextButton?.setAttribute('aria-pressed', 'true');
      nextButton?.setAttribute('aria-label', 'Viewed');
      wrapper.replaceWith(next);
    });

    const result = await markViewed(snapshot, ['src/app.ts'], true, {
      timeoutMs: 20,
    });

    expect(result.completed).toEqual(['src/app.ts']);
    expect(result.failed).toEqual([]);
  });

  it('overlays every file and folder icon with deterministic viewed actions', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    document.querySelector('[role="tree"]')?.insertAdjacentHTML(
      'afterbegin',
      '<li id="src" role="treeitem" aria-label="src">' +
        '<div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div></li>',
    );
    const onAction = vi.fn();

    mountViewedActions(snapshot, onAction);
    mountViewedActions(snapshot, onAction);
    document
      .querySelector<HTMLButtonElement>(
        '#src [data-diffseek-viewed-action="true"]',
      )
      ?.click();

    expect(document.querySelectorAll('[data-diffseek-viewed-action="true"]')).toHaveLength(
      6,
    );
    const fileAction = document.querySelector<HTMLButtonElement>(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    expect(fileAction?.title).toBe('Mark as viewed');
    expect(fileAction?.getAttribute('aria-label')).toBe('Mark as viewed');
    expect(fileAction?.getAttribute('aria-pressed')).toBe('false');
    // CSS-only: the toggle is GitHub's own icon wrapper; nothing is inserted.
    expect(document.querySelectorAll('[role="tree"] button')).toHaveLength(0);
    expect(fileAction?.firstElementChild).toMatchObject({ tagName: 'svg' });
    expect(fileAction?.childElementCount).toBe(1);
    expect(fileAction?.classList).toContain('diffseek-viewed-icon-anchor');
    const folder = document.querySelector<HTMLElement>(
      '#src [data-diffseek-viewed-action="true"]',
    );
    expect(folder?.title).toBe('Mark 3 remaining as viewed (0 of 3 viewed)');
    expect(folder?.getAttribute('aria-pressed')).toBe('false');
    expect(onAction).toHaveBeenCalledWith(
      true,
      ['src/app.ts', 'src/new.ts', 'src/generated.ts'],
      'Marked 3 visible files in src viewed',
    );

    const viewedFile = document.querySelector<HTMLButtonElement>(
      '#docs\\/readme\\.md [data-diffseek-viewed-action="true"]',
    );
    expect(viewedFile?.title).toBe('Mark as not viewed');
    expect(viewedFile?.getAttribute('aria-pressed')).toBe('true');
    viewedFile?.click();
    expect(onAction).toHaveBeenLastCalledWith(false, ['docs/readme.md']);
  });

  it('uses an eclipse for a partly viewed folder and skips hidden files', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    document.querySelector('[role="tree"]')?.insertAdjacentHTML(
      'afterbegin',
      '<li id="src" role="treeitem" aria-label="src">' +
        '<div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div></li>',
    );
    const app = snapshot.files.find((file) => file.path === 'src/app.ts');
    const created = snapshot.files.find((file) => file.path === 'src/new.ts');
    const generated = snapshot.files.find((file) => file.path === 'src/generated.ts');
    if (!app || !created || !generated) throw new Error('Missing fixture file');
    app.viewed = true;
    app.labels = [{ facet: 'viewed', value: 'true' }, { facet: 'generated', value: 'false' }];
    created.labels = [{ facet: 'generated', value: 'false' }];
    generated.labels = [{ facet: 'generated', value: 'true' }];
    const filters = emptyFacetExclusions();
    filters.get('viewed')?.add('true');
    filters.get('generated')?.add('true');
    const onAction = vi.fn();

    mountViewedActions(snapshot, onAction, new ReviewIndex(snapshot.files), filters);
    const folder = document.querySelector<HTMLElement>(
      '#src [data-diffseek-viewed-action="true"]',
    );
    folder?.click();

    expect(folder?.getAttribute('aria-pressed')).toBe('mixed');
    expect(folder?.classList.contains('diffseek-viewed-partial')).toBe(true);
    expect(folder?.getAttribute('aria-label')).toBe(
      'Mark 1 remaining as viewed (1 of 2 viewed)',
    );
    expect(onAction).toHaveBeenCalledWith(
      true,
      ['src/new.ts'],
      'Marked 1 visible file in src viewed',
    );
    expect(
      document.querySelector('#src\\/generated\\.ts [data-diffseek-viewed-action]'),
    ).toBeNull();
    expect(
      document.querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Mark as not viewed');
  });

  it('clears viewed state for a filled folder', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    document.querySelector('[role="tree"]')?.insertAdjacentHTML(
      'afterbegin',
      '<li id="src" role="treeitem" aria-label="src">' +
        '<div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div></li>',
    );
    for (const path of ['src/app.ts', 'src/new.ts', 'src/generated.ts']) {
      const file = snapshot.files.find((candidate) => candidate.path === path);
      if (!file) throw new Error(`Missing ${path}`);
      file.viewed = true;
    }
    const onAction = vi.fn();

    mountViewedActions(snapshot, onAction);
    const folder = document.querySelector<HTMLElement>(
      '#src [data-diffseek-viewed-action="true"]',
    );
    expect(folder?.classList.contains('diffseek-viewed-partial')).toBe(false);
    folder?.click();

    expect(onAction).toHaveBeenCalledWith(
      false,
      ['src/app.ts', 'src/new.ts', 'src/generated.ts'],
      'Unmarked 3 visible files in src',
    );
  });

  it('updates existing overlays in place during reconciliation', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const firstAction = vi.fn();
    mountViewedActions(snapshot, firstAction);
    const overlay = document.querySelector<HTMLButtonElement>(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    const file = snapshot.files.find(({ path }) => path === 'src/app.ts');
    if (!file) throw new Error('Missing fixture file');
    file.viewed = true;

    const nextAction = vi.fn();
    mountViewedActions(snapshot, nextAction);
    const reconciled = document.querySelector<HTMLButtonElement>(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    reconciled?.click();

    expect(reconciled).toBe(overlay);
    expect(reconciled?.getAttribute('aria-pressed')).toBe('true');
    expect(reconciled?.title).toBe('Mark as not viewed');
    expect(firstAction).not.toHaveBeenCalled();
    expect(nextAction).toHaveBeenCalledWith(false, ['src/app.ts']);
  });

  it('ignores clicks outside the toggle hit area and lets GitHub handle them', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const onAction = vi.fn();
    mountViewedActions(snapshot, onAction);
    const anchor = document.querySelector<HTMLElement>(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    if (!anchor) throw new Error('Missing anchor');
    anchor.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 26, bottom: 26 }) as DOMRect;
    const native = vi.fn();
    document.addEventListener('click', native);

    const outside = new MouseEvent('click', {
      bubbles: true, cancelable: true, detail: 1, clientX: 60, clientY: 60,
    });
    anchor.dispatchEvent(outside);
    const inside = new MouseEvent('click', {
      bubbles: true, cancelable: true, detail: 1, clientX: 28, clientY: 28,
    });
    anchor.dispatchEvent(inside);
    document.removeEventListener('click', native);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(inside.defaultPrevented).toBe(true);
    expect(outside.defaultPrevented).toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('clears toggle attributes when a row no longer has viewable files', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    mountViewedActions(snapshot, vi.fn());
    for (const file of snapshot.files) file.capabilities.viewed = false;

    mountViewedActions(snapshot, vi.fn());

    expect(document.querySelector('[data-diffseek-viewed-action]')).toBeNull();
    expect(document.querySelector('.diffseek-viewed-icon-anchor')).toBeNull();
    expect(document.querySelector('[role="tree"] [aria-pressed]')).toBeNull();
  });

  it('does not mutate retained overlay state when it is unchanged', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    mountViewedActions(snapshot, vi.fn());
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['aria-label', 'aria-pressed'],
    });

    mountViewedActions(snapshot, vi.fn());
    await Promise.resolve();
    observer.disconnect();

    expect(mutations).toEqual([]);
  });
});
