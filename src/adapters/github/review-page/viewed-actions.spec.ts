import { emptyFacetExclusions, type FileRecord, ReviewIndex } from '@diffseek/review';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageSnapshot } from './page-adapter';

import fixture from './fixtures/github-pr.html?raw';
import { scanPage } from './page-adapter';
import { parseFragment, replaceDocument } from './test-dom';
import {
  type ActionResult,
  markViewed,
  mountViewedActions,
  type ViewedTarget,
} from './viewed-actions';

const appPath = 'src/app.ts';
const createdPath = 'src/new.ts';
const generatedPath = 'src/generated.ts';
const readmePath = 'docs/readme.md';
const srcFolder = 'src';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;
type ViewedHandler = (
  target: ViewedTarget,
  viewed: boolean,
  paths: string[],
) => void;

function confirmCreated(snapshot: SupportedSnapshot): void {
  const supported = snapshot.viewedControl(createdPath);
  if (supported) confirmViewed(supported);
}

function confirmViewed(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', 'Viewed');
  });
}

function iframeAnchor(frameDocument: Document): HTMLElement {
  const anchor = frameDocument.querySelector<HTMLElement>(
    '[data-diffseek-viewed-action="true"]',
  );
  if (!anchor) throw new Error('Missing iframe anchor');
  return anchor;
}

function iframeDocument(): Document {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (frameDocument === null) throw new Error('Missing iframe document');
  return frameDocument;
}

function iframeFile(path: string): FileRecord {
  return {
    anchor: 'diff-src-app',
    capabilities: { collapse: false, viewed: true },
    extension: 'ts',
    generated: false,
    labels: [],
    owners: [],
    path,
    status: 'modified',
    viewed: false,
  };
}

function iframeSnapshot(
  frameDocument: Document,
  tree: HTMLElement,
  path: string,
): SupportedSnapshot {
  return {
    collapseControl: (): null => null,
    files: [iframeFile(path)],
    region: (): null => null,
    supported: true,
    tree: (): HTMLElement => tree,
    treeItem: (): HTMLElement | null => frameDocument.getElementById(path),
    treeItems: (): HTMLElement[] =>
      [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')],
    unavailable: new Map(),
    viewedControl: (): null => null,
  };
}

function iframeTree(frameDocument: Document, path: string): HTMLElement {
  const tree = frameDocument.createElement('div');
  tree.setAttribute('role', 'tree');
  const item = frameDocument.createElement('div');
  item.id = path;
  item.setAttribute('role', 'treeitem');
  const iconWrap = frameDocument.createElement('div');
  const icon = frameDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'octicon octicon-file');
  iconWrap.append(icon);
  item.append(iconWrap);
  tree.append(item);
  frameDocument.body.append(tree);
  return tree;
}

function loadFixture(): void {
  replaceDocument(fixture);
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

function requireAnchor(): HTMLElement {
  const anchor = document.querySelector<HTMLElement>(
    '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
  );
  if (!anchor) throw new Error('Missing anchor');
  return anchor;
}

function requireButton(selector: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  return button;
}

function requireFile(
  snapshot: SupportedSnapshot,
  path: string,
): SupportedSnapshot['files'][number] {
  const file = snapshot.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`Missing ${path}`);
  return file;
}

function requireSupported(): SupportedSnapshot {
  const snapshot = scanPage(document);
  if (snapshot.supported) return snapshot;
  throw new Error(snapshot.reason);
}

function viewedHandler(): ReturnType<typeof vi.fn<ViewedHandler>> {
  return vi.fn<ViewedHandler>();
}

describe('markViewed', () => {
  beforeEach(loadFixture);

  it('uses existing controls sequentially and verifies their state', async () => {
    const snapshot = requireSupported();
    for (const path of [appPath, createdPath]) {
      const button = snapshot.viewedControl(path);
      if (button) confirmViewed(button);
    }

    const result = await markViewed(snapshot, [appPath, createdPath], true, {
      timeoutMs: 20,
    });

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

    const result = await markViewed(snapshot, [appPath], true, {
      timeoutMs: 5,
    });

    expect(clicks).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent));
    expect(result.completed).toStrictEqual([]);
    expect(result.failed).toStrictEqual([appPath]);
  });

  it('continues with supported files after a viewed control is unavailable', async () => {
    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.remove();
    const snapshot = requireSupported();
    confirmCreated(snapshot);

    const result = await markViewed(snapshot, [appPath, createdPath], true, {
      timeoutMs: 20,
    });

    expect(result).toStrictEqual({
      completed: [createdPath],
      failed: [appPath],
      requested: 2,
    });
  });

  it('confirms state on the viewed control GitHub replaces after the click', async () => {
    const snapshot = requireSupported();
    swapViewedControl(snapshot.viewedControl(appPath));
    const replaced = await markApp(snapshot);
    expect(replaced.completed).toStrictEqual([appPath]);
    expect(replaced.failed).toStrictEqual([]);
  });

  it('confirms state when GitHub replaces the header wrapper after the click', async () => {
    const snapshot = requireSupported();
    const button = snapshot.viewedControl(appPath);
    button?.addEventListener('click', () => {
      replaceHeader(button);
    });
    const replaced = await markApp(snapshot);
    expect(replaced.failed).toStrictEqual([]);
    expect(replaced.completed).toStrictEqual([appPath]);
  });
});

function markApp(snapshot: SupportedSnapshot): Promise<ActionResult> {
  return markViewed(snapshot, [appPath], true, { timeoutMs: 20 });
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
    const onAction = viewedHandler();

    mountViewedActions(snapshot, onAction);
    mountViewedActions(snapshot, onAction);
    requireButton(`#${srcFolder} [data-diffseek-viewed-action="true"]`).click();

    expect(
      document.querySelectorAll('[data-diffseek-viewed-action="true"]'),
    ).toHaveLength(6);
    const fileAction = requireButton(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    expect(fileAction.title).toBe('Mark viewed');
    expect(fileAction.getAttribute('aria-label')).toBe('Mark viewed');
    expect(fileAction.getAttribute('aria-pressed')).toBe('false');
    // CSS-only: the toggle is GitHub's own icon wrapper; nothing is inserted.
    expect(document.querySelectorAll('[role="tree"] button')).toHaveLength(0);
    expect(fileAction.firstElementChild).toMatchObject({ tagName: 'svg' });
    expect(fileAction.childElementCount).toBe(1);
    expect(fileAction.classList).toContain('diffseek-viewed-icon-anchor');
    const folder = requireButton(
      `#${srcFolder} [data-diffseek-viewed-action="true"]`,
    );
    expect(folder.title).toBe('Mark all viewed');
    expect(folder.getAttribute('aria-pressed')).toBe('false');
    expect(onAction).toHaveBeenCalledWith('folder', true, [
      appPath,
      createdPath,
      generatedPath,
    ]);

    const viewedFile = requireButton(
      '#docs\\/readme\\.md [data-diffseek-viewed-action="true"]',
    );
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
    const onAction = viewedHandler();

    mountViewedActions(
      snapshot,
      onAction,
      new ReviewIndex(snapshot.files),
      filters,
    );
    const folder = requireButton(
      `#${srcFolder} [data-diffseek-viewed-action="true"]`,
    );
    folder.click();

    expect(folder.getAttribute('aria-pressed')).toBe('mixed');
    expect(folder.classList.contains('diffseek-viewed-partial')).toBe(true);
    expect(folder.getAttribute('aria-label')).toBe('Mark the rest viewed');
    expect(onAction).toHaveBeenCalledWith('folder', true, [createdPath]);
    expect(
      document.querySelector('#src\\/generated\\.ts [data-diffseek-viewed-action]'),
    ).toBeNull();
    expect(
      document
        .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Unmark');
  });

  it('clears viewed state for a filled folder', () => {
    const snapshot = requireSupported();
    prependFolder();
    for (const path of [appPath, createdPath, generatedPath]) {
      requireFile(snapshot, path).viewed = true;
    }
    const onAction = viewedHandler();

    mountViewedActions(snapshot, onAction);
    const folder = requireButton(
      `#${srcFolder} [data-diffseek-viewed-action="true"]`,
    );
    expect(folder.classList.contains('diffseek-viewed-partial')).toBe(false);
    folder.click();

    expect(onAction).toHaveBeenCalledWith('folder', false, [
      appPath,
      createdPath,
      generatedPath,
    ]);
  });
});

describe('viewed action reconciliation', () => {
  beforeEach(loadFixture);

  it('updates existing overlays in place during reconciliation', () => {
    const snapshot = requireSupported();
    const firstAction = viewedHandler();
    mountViewedActions(snapshot, firstAction);
    const overlay = requireButton(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    requireFile(snapshot, appPath).viewed = true;

    const nextAction = viewedHandler();
    mountViewedActions(snapshot, nextAction);
    const reconciled = requireButton(
      '#src\\/app\\.ts [data-diffseek-viewed-action="true"]',
    );
    reconciled.click();

    expect(reconciled).toBe(overlay);
    expect(reconciled.getAttribute('aria-pressed')).toBe('true');
    expect(reconciled.title).toBe('Unmark');
    expect(firstAction).not.toHaveBeenCalled();
    expect(nextAction).toHaveBeenCalledWith('file', false, [appPath]);
  });

  it('ignores clicks outside the toggle hit area and lets GitHub handle them', () => {
    const snapshot = requireSupported();
    const onAction = viewedHandler();
    mountViewedActions(snapshot, onAction);
    const anchor = requireAnchor();
    anchor.getBoundingClientRect = (): DOMRect => new DOMRect(10, 10, 16, 16);
    const native = vi.fn<(event: MouseEvent) => void>();
    document.addEventListener('click', native);

    const outside = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 60,
      clientY: 60,
      detail: 1,
    });
    anchor.dispatchEvent(outside);
    const inside = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 28,
      clientY: 28,
      detail: 1,
    });
    anchor.dispatchEvent(inside);
    document.removeEventListener('click', native);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(inside.defaultPrevented).toBe(true);
    expect(outside.defaultPrevented).toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('clears toggle attributes when a row no longer has viewable files', () => {
    const snapshot = requireSupported();
    mountViewedActions(snapshot, viewedHandler());
    for (const file of snapshot.files) file.capabilities.viewed = false;

    mountViewedActions(snapshot, viewedHandler());

    expect(document.querySelector('[data-diffseek-viewed-action]')).toBeNull();
    expect(document.querySelector('.diffseek-viewed-icon-anchor')).toBeNull();
    expect(document.querySelector('[role="tree"] [aria-pressed]')).toBeNull();
  });

  it('handles a viewed click whose target lives in an iframe document', () => {
    const frameDocument = iframeDocument();
    const path = 'src/app.ts';
    const tree = iframeTree(frameDocument, path);
    const onAction = viewedHandler();
    mountViewedActions(iframeSnapshot(frameDocument, tree, path), onAction);
    const anchor = iframeAnchor(frameDocument);
    expect(anchor).not.toBeInstanceOf(Element);
    anchor.click();
    expect(onAction).toHaveBeenCalledWith('file', true, [path]);
  });

  it('does not mutate retained overlay state when it is unchanged', async () => {
    const snapshot = requireSupported();
    mountViewedActions(snapshot, viewedHandler());
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records): void => {
      mutations.push(...records);
    });
    observer.observe(document.body, {
      attributeFilter: ['aria-label', 'aria-pressed'],
      attributes: true,
      subtree: true,
    });

    mountViewedActions(snapshot, viewedHandler());
    await Promise.resolve();
    observer.disconnect();

    expect(mutations).toStrictEqual([]);
  });
});
