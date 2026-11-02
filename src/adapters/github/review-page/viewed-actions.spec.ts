import { emptyFacetExclusions } from '@diffseek/review';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupportedSnapshot } from './page-adapter';

import fixture from './fixtures/github-pr.html?raw';
import { parseFragment, replaceDocument, requireSupported } from './test-dom';
import {
  type ActionResult,
  markViewed,
  mountViewedActions,
} from './viewed-actions';

const appPath = 'src/app.ts';
const createdPath = 'src/new.ts';
const generatedPath = 'src/generated.ts';
const readmePath = 'docs/readme.md';
const srcFiles = [appPath, createdPath, generatedPath];
const srcFolder = 'src';

type ViewedHandler = Parameters<typeof mountViewedActions>[1];

function confirmViewed(button: HTMLButtonElement | null): void {
  button?.addEventListener('click', () => {
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', 'Viewed');
  });
}

function iframeDocument(): Document {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (frameDocument === null) throw new Error('Missing iframe document');
  return frameDocument;
}

function loadFixture(): void {
  replaceDocument(fixture);
}

function pointerClick(at: number): MouseEvent {
  return new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: at,
    clientY: at,
    detail: 1,
  });
}

function prependFolder(): void {
  const tree = document.querySelector('[role="tree"]');
  if (!tree) throw new Error('Missing tree');
  tree.prepend(
    parseFragment(
      `<li id="${srcFolder}" role="treeitem" aria-label="${srcFolder}"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div></li>`,
    ),
  );
}

function requireAnchor(path = appPath, root: ParentNode = document): HTMLElement {
  const anchor = root.querySelector<HTMLElement>(
    `#${CSS.escape(path)} [data-diffseek-viewed-action="true"]`,
  );
  if (!anchor) throw new Error(`Missing ${path} anchor`);
  return anchor;
}

function requireFile(
  snapshot: SupportedSnapshot,
  path: string,
): SupportedSnapshot['files'][number] {
  const file = snapshot.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`Missing ${path}`);
  return file;
}

describe('markViewed', () => {
  beforeEach(loadFixture);

  it('uses existing controls sequentially and verifies their state', async () => {
    const snapshot = requireSupported();
    for (const path of [appPath, createdPath]) {
      confirmViewed(snapshot.viewedControl(path));
    }

    const result = await mark(snapshot, [appPath, createdPath]);

    expect(result).toStrictEqual({
      completed: [appPath, createdPath],
      failed: [],
      requested: 2,
    });
  });

  it('reports a control that GitHub does not confirm without retrying', async () => {
    const snapshot = requireSupported();
    const button = snapshot.viewedControl(appPath);
    const clicks = vi.fn<(event: MouseEvent) => void>();
    button?.addEventListener('click', clicks);

    const result = await mark(snapshot, [appPath], 5);

    expect(clicks).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent));
    expect(result.completed).toStrictEqual([]);
    expect(result.failed).toStrictEqual([appPath]);
  });

  it('continues with supported files after a viewed control is unavailable', async () => {
    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.remove();
    const snapshot = requireSupported();
    confirmViewed(snapshot.viewedControl(createdPath));

    const result = await mark(snapshot, [appPath, createdPath]);

    expect(result).toStrictEqual({
      completed: [createdPath],
      failed: [appPath],
      requested: 2,
    });
  });

  it('confirms state on the viewed control GitHub replaces after the click', async () => {
    const snapshot = requireSupported();
    swapViewedControl(snapshot.viewedControl(appPath));
    const replaced = await mark(snapshot);
    expect(replaced.completed).toStrictEqual([appPath]);
    expect(replaced.failed).toStrictEqual([]);
  });

  it('confirms state when GitHub replaces the header wrapper after the click', async () => {
    const snapshot = requireSupported();
    const button = snapshot.viewedControl(appPath);
    button?.addEventListener('click', () => {
      replaceHeader(button);
    });
    const replaced = await mark(snapshot);
    expect(replaced.failed).toStrictEqual([]);
    expect(replaced.completed).toStrictEqual([appPath]);
  });
});

function mark(
  snapshot: SupportedSnapshot,
  paths = [appPath],
  timeoutMs = 20,
): Promise<ActionResult> {
  return markViewed(snapshot, paths, { timeoutMs, viewed: true });
}

function replaceHeader(button: HTMLButtonElement | null): void {
  if (!button) return;
  const wrapper = button.closest('[data-diff-header-wrapper="true"]');
  const region = button.closest('[role="region"]');
  if (!wrapper || !region) throw new Error('Missing wrapper');
  const next = wrapper.cloneNode(true);
  if (!(next instanceof HTMLElement)) throw new TypeError('Missing wrapper');
  const nextButton = next.querySelector<HTMLButtonElement>(
    'button[aria-label="Not Viewed"], button[aria-label="Viewed"]',
  );
  nextButton?.setAttribute('aria-pressed', 'true');
  nextButton?.setAttribute('aria-label', 'Viewed');
  wrapper.replaceWith(next);
}

function swapViewedControl(button: HTMLButtonElement | null): void {
  if (!button) return;
  button.addEventListener('click', () => {
    const replacement = button.cloneNode(true);
    if (!(replacement instanceof HTMLButtonElement)) return;
    replacement.setAttribute('aria-pressed', 'true');
    replacement.setAttribute('aria-label', 'Viewed');
    button.replaceWith(replacement);
  });
}

describe('viewed action overlays', () => {
  beforeEach(loadFixture);

  it('overlays every file and folder icon with deterministic viewed actions', () => {
    const snapshot = requireSupported();
    prependFolder();
    const onAction = vi.fn<ViewedHandler>();

    mountViewedActions(snapshot, onAction);
    mountViewedActions(snapshot, onAction);
    requireAnchor(srcFolder).click();

    expect(
      document.querySelectorAll('[data-diffseek-viewed-action="true"]'),
    ).toHaveLength(6);
    const fileAction = requireAnchor();
    expect(fileAction.title).toBe('Mark viewed');
    expect(fileAction.getAttribute('aria-label')).toBe('Mark viewed');
    expect(fileAction.getAttribute('aria-pressed')).toBe('false');
    // CSS-only: the toggle is GitHub's own icon wrapper; nothing is inserted.
    expect(document.querySelectorAll('[role="tree"] button')).toHaveLength(0);
    expect(fileAction.firstElementChild).toMatchObject({ tagName: 'svg' });
    expect(fileAction.childElementCount).toBe(1);
    expect(fileAction.classList).toContain('diffseek-viewed-icon-anchor');
    const folder = requireAnchor(srcFolder);
    expect(folder.title).toBe('Mark all viewed');
    expect(folder.getAttribute('aria-pressed')).toBe('false');
    expect(onAction).toHaveBeenCalledWith('folder', true, srcFiles);

    const viewedFile = requireAnchor(readmePath);
    expect(viewedFile.title).toBe('Unmark');
    expect(viewedFile.getAttribute('aria-pressed')).toBe('true');
    viewedFile.click();
    expect(onAction).toHaveBeenLastCalledWith('file', false, [readmePath]);
  });

  it('uses an eclipse for a partly viewed folder and skips hidden files', () => {
    const snapshot = requireSupported();
    prependFolder();
    const app = requireFile(snapshot, appPath);
    const created = requireFile(snapshot, createdPath);
    const generated = requireFile(snapshot, generatedPath);
    app.viewed = true;
    app.labels = [
      { facet: 'viewed', value: 'true' },
      { facet: 'generated', value: 'false' },
    ];
    created.labels = [{ facet: 'generated', value: 'false' }];
    generated.labels = [{ facet: 'generated', value: 'true' }];
    const filters = emptyFacetExclusions();
    filters.get('viewed')?.add('true');
    filters.get('generated')?.add('true');
    const onAction = vi.fn<ViewedHandler>();

    mountViewedActions(snapshot, onAction, { filters });
    const folder = requireAnchor(srcFolder);
    folder.click();

    expect(folder.getAttribute('aria-pressed')).toBe('mixed');
    expect(folder.classList.contains('diffseek-viewed-partial')).toBe(true);
    expect(folder.getAttribute('aria-label')).toBe('Mark the rest viewed');
    expect(onAction).toHaveBeenCalledWith('folder', true, [createdPath]);
    expect(
      document.querySelector('#src\\/generated\\.ts [data-diffseek-viewed-action]'),
    ).toBeNull();
    expect(requireAnchor().getAttribute('aria-label')).toBe('Unmark');
  });

  it('clears viewed state for a filled folder', () => {
    const snapshot = requireSupported();
    prependFolder();
    for (const path of srcFiles) {
      requireFile(snapshot, path).viewed = true;
    }
    const onAction = vi.fn<ViewedHandler>();

    mountViewedActions(snapshot, onAction);
    const folder = requireAnchor(srcFolder);
    expect(folder.classList.contains('diffseek-viewed-partial')).toBe(false);
    folder.click();

    expect(onAction).toHaveBeenCalledWith('folder', false, srcFiles);
  });
});

describe('viewed action reconciliation', () => {
  beforeEach(loadFixture);

  it('updates existing overlays in place during reconciliation', () => {
    const snapshot = requireSupported();
    const firstAction = vi.fn<ViewedHandler>();
    mountViewedActions(snapshot, firstAction);
    const overlay = requireAnchor();
    requireFile(snapshot, appPath).viewed = true;

    const nextAction = vi.fn<ViewedHandler>();
    mountViewedActions(snapshot, nextAction);
    const reconciled = requireAnchor();
    reconciled.click();

    expect(reconciled).toBe(overlay);
    expect(reconciled.getAttribute('aria-pressed')).toBe('true');
    expect(reconciled.title).toBe('Unmark');
    expect(firstAction).not.toHaveBeenCalled();
    expect(nextAction).toHaveBeenCalledWith('file', false, [appPath]);
  });

  it('ignores clicks outside the toggle hit area and lets GitHub handle them', () => {
    const snapshot = requireSupported();
    const onAction = vi.fn<ViewedHandler>();
    mountViewedActions(snapshot, onAction);
    const anchor = requireAnchor();
    anchor.getBoundingClientRect = (): DOMRect => new DOMRect(10, 10, 16, 16);
    const native = vi.fn<(event: MouseEvent) => void>();
    document.addEventListener('click', native);

    const outside = pointerClick(60);
    anchor.dispatchEvent(outside);
    const inside = pointerClick(28);
    anchor.dispatchEvent(inside);
    document.removeEventListener('click', native);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(inside.defaultPrevented).toBe(true);
    expect(outside.defaultPrevented).toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('clears toggle attributes when a row no longer has viewable files', () => {
    const snapshot = requireSupported();
    mountViewedActions(snapshot, vi.fn<ViewedHandler>());
    for (const file of snapshot.files) file.capabilities.viewed = false;

    mountViewedActions(snapshot, vi.fn<ViewedHandler>());

    expect(document.querySelector('[data-diffseek-viewed-action]')).toBeNull();
    expect(document.querySelector('.diffseek-viewed-icon-anchor')).toBeNull();
    expect(document.querySelector('[role="tree"] [aria-pressed]')).toBeNull();
  });

  it('handles a viewed click whose target lives in an iframe document', () => {
    const frameDocument = iframeDocument();
    replaceDocument(fixture, frameDocument);
    const onAction = vi.fn<ViewedHandler>();
    mountViewedActions(requireSupported(frameDocument), onAction);
    const anchor = requireAnchor(appPath, frameDocument);
    expect(anchor).not.toBeInstanceOf(Element);
    anchor.click();
    expect(onAction).toHaveBeenCalledWith('file', true, [appPath]);
  });

  it('does not mutate retained overlay state when it is unchanged', async () => {
    const snapshot = requireSupported();
    mountViewedActions(snapshot, vi.fn<ViewedHandler>());
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records): void => {
      mutations.push(...records);
    });
    observer.observe(document.body, {
      attributeFilter: ['aria-label', 'aria-pressed'],
      attributes: true,
      subtree: true,
    });

    mountViewedActions(snapshot, vi.fn<ViewedHandler>());
    await Promise.resolve();
    observer.disconnect();

    expect(mutations).toStrictEqual([]);
  });
});
