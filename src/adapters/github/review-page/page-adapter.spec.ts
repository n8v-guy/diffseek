import { beforeEach, describe, expect, it } from 'vitest';

import edgeCases from './fixtures/github-pr-edge-cases.html?raw';
import fixture from './fixtures/github-pr.html?raw';
import type { PageSnapshot } from './page-adapter';
import {
  pageStructureKey,
  refreshObservedFiles,
  regionStructureKey,
  scanPage,
  treeStructureKey,
} from './page-adapter';
import { parseFragment, replaceDocument } from './test-dom';

const appPath = 'src/app.ts';
const diffApp = 'diff-app';
const lazyPath = 'src/lazy.ts';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

function appendHtml(parent: ParentNode, html: string): void {
  parent.append(parseFragment(html));
}

function asSupported(snapshot: PageSnapshot): SupportedSnapshot {
  if (snapshot.supported) return snapshot;
  throw new Error(snapshot.reason);
}

function cloneAppRegion(): void {
  const region = document.getElementById(diffApp);
  if (!region) throw new Error(`Missing ${diffApp}`);
  region.after(region.cloneNode(true));
}

function loadFixture(): void {
  replaceDocument(fixture);
}

function nestAppInFolder(): void {
  const tree = document.querySelector('[role="tree"]');
  const file = document.getElementById(appPath);
  if (!tree || !file) throw new Error('Missing tree row');
  const folder = document.createElement('li');
  const group = document.createElement('ul');
  folder.id = 'src';
  folder.setAttribute('role', 'treeitem');
  group.setAttribute('role', 'group');
  folder.append(group);
  group.append(file);
  tree.prepend(folder);
}

function removeControl(name: string): void {
  document
    .querySelector(`#${diffApp} button[aria-label="${CSS.escape(name)}"]`)
    ?.remove();
}

function removeSecond(id: string): void {
  const nodes = [...document.querySelectorAll(`[id="${CSS.escape(id)}"]`)];
  nodes[1]?.remove();
}

function replaceViewedControl(snapshot: SupportedSnapshot): HTMLButtonElement {
  const original = snapshot.viewedControl(appPath);
  if (!original) throw new Error('Missing viewed control');
  const replacement = original.cloneNode(true);
  if (!(replacement instanceof HTMLButtonElement)) {
    throw new TypeError('Missing replacement');
  }
  original.replaceWith(replacement);
  return replacement;
}

function requireApp(
  snapshot: SupportedSnapshot,
): SupportedSnapshot['files'][number] {
  const file = snapshot.files.find((entry) => entry.path === appPath);
  if (!file) throw new Error(`Missing ${appPath}`);
  return file;
}

function requireTree(): Element {
  const tree = document.querySelector('[role="tree"]');
  if (!tree) throw new Error('Missing tree');
  return tree;
}

describe('scanPage contracts', () => {
  beforeEach(loadFixture);

  it('maps GitHub semantic DOM into normalized files', () => {
    const snapshot = asSupported(scanPage(document));

    expect(snapshot.files).toHaveLength(5);
    expect(snapshot.files.find((file) => file.path === 'src/new.ts')).toMatchObject({
      anchor: 'diff-new',
      capabilities: { collapse: true, viewed: true },
      extension: '.ts',
      status: 'added',
      viewed: false,
    });
    expect(
      snapshot.files.find((file) => file.path === 'src/generated.ts'),
    ).toMatchObject({
      generated: false,
      owners: ['@owner', '@org/team'],
      status: 'modified',
    });
    expect(
      snapshot.files.find((file) => file.path === 'docs/readme.md'),
    ).toMatchObject({
      extension: '.md',
      viewed: true,
    });
  });

  it('returns unsupported instead of guessing missing contracts', () => {
    document.body.replaceChildren(parseFragment('<main>GitHub changed</main>'));

    expect(scanPage(document)).toStrictEqual({
      reason: 'No file tree on this page',
      supported: false,
    });
  });

  it('resolves native control names exposed through aria-labelledby', () => {
    const button = document.querySelector<HTMLButtonElement>(
      `#${diffApp} button[aria-label="Collapse file"]`,
    );
    button?.removeAttribute('aria-label');
    button?.setAttribute('aria-labelledby', 'collapse-label');
    appendHtml(
      document.body,
      '<span id="collapse-label">Collapse file</span>',
    );

    expect(scanPage(document).supported).toBe(true);
  });

  it('indexes tree rows before their diff regions hydrate', () => {
    appendHtml(
      requireTree(),
      `
        <li id="src/lazy.ts" role="treeitem" aria-label="lazy.ts">
          <div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-diff"></svg></div>
          <a href="#diff-lazy">lazy.ts</a>
        </li>
      `,
    );

    const stub = asSupported(scanPage(document));
    expect(stub.files.find((file) => file.path === lazyPath)).toMatchObject({
      anchor: 'diff-lazy',
      capabilities: { collapse: false, viewed: false },
      status: 'modified',
      viewed: false,
    });
    expect(stub.unavailable.has(lazyPath)).toBe(false);

    appendHtml(
      document.body,
      `
        <div id="diff-lazy" role="region" aria-labelledby="heading-lazy">
          <div data-diff-header-wrapper="true">
            <button aria-label="Collapse file"></button>
            <h3 id="heading-lazy"><a href="#diff-lazy"><code>src/lazy.ts</code></a></h3>
            <button aria-label="Not Viewed" aria-pressed="false">Viewed</button>
          </div>
          <div data-diff-anchor="diff-lazy">lazy diff</div>
        </div>
      `,
    );

    const ready = asSupported(scanPage(document));
    expect(ready.files.find((file) => file.path === lazyPath)).toMatchObject({
      capabilities: { collapse: true, viewed: true },
    });
  });
});

describe('scanPage tree structure', () => {
  beforeEach(loadFixture);

  it('ignores nested folder treeitems that inherit a descendant file link', () => {
    nestAppInFolder();

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files).toHaveLength(5);
    expect(snapshot.files.some((candidate) => candidate.path === appPath)).toBe(
      true,
    );
  });

  it('keeps diff regions addressable when a collapsed folder unmounts file rows', () => {
    document.getElementById(appPath)?.remove();

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files.some(({ path }) => path === appPath)).toBe(false);
    expect(snapshot.region(appPath)?.id).toBe(diffApp);
    expect(snapshot.viewedControl(appPath)).not.toBeNull();
  });

  it('keeps tree membership when a transient duplicate diff region appears', () => {
    cloneAppRegion();
    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files.find((file) => file.path === appPath)).toMatchObject({
      capabilities: { collapse: false, viewed: false },
      status: 'modified',
      viewed: false,
    });
    expect(snapshot.unavailable.has(appPath)).toBe(false);
    expect(snapshot.viewedControl(appPath)).toBeNull();
    expect(snapshot.files).toHaveLength(5);

    removeSecond(diffApp);
    const ready = asSupported(scanPage(document));
    expect(ready.files.find((file) => file.path === appPath)).toMatchObject({
      capabilities: { collapse: true, viewed: true },
    });
    expect(ready.viewedControl(appPath)).not.toBeNull();
  });

  it('does not catalog folder rows when a descendant file has duplicate regions', () => {
    nestAppInFolder();
    cloneAppRegion();

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files.some((candidate) => candidate.path === 'src')).toBe(
      false,
    );
    expect(snapshot.files.find((candidate) => candidate.path === appPath)).toMatchObject(
      {
        capabilities: { collapse: false, viewed: false },
      },
    );
  });
});

describe('scanPage missing controls', () => {
  beforeEach(loadFixture);

  it('keeps filtering available when only a viewed control is missing', () => {
    removeControl('Not Viewed');

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files.some((file) => file.path === appPath)).toBe(true);
    expect(snapshot.viewedControl(appPath)).toBeNull();
    expect(requireApp(snapshot).capabilities).toStrictEqual({
      collapse: true,
      viewed: false,
    });
  });

  it('keeps a file observable when only its collapse control is missing', () => {
    removeControl('Collapse file');

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files.some((file) => file.path === appPath)).toBe(true);
    expect(snapshot.collapseControl(appPath)).toBeNull();
  });

  it('owns live control resolution behind the semantic page interface', () => {
    const snapshot = asSupported(scanPage(document));
    const replacement = replaceViewedControl(snapshot);

    expect('bindings' in snapshot).toBe(false);
    expect(snapshot.viewedControl(appPath)).toBe(replacement);
    expect(snapshot.collapseControl(appPath)).not.toBeNull();
    expect(snapshot.treeItem(appPath)?.id).toBe(appPath);
  });
});

describe('scanPage edge cases and refresh', () => {
  beforeEach(loadFixture);

  it('covers deleted, renamed, binary, and alternative accessible-name contracts', () => {
    replaceDocument(edgeCases);

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files).toStrictEqual([
      expect.objectContaining({
        capabilities: { collapse: true, viewed: true },
        path: 'src/removed.ts',
        status: 'deleted',
      }),
      expect.objectContaining({
        capabilities: { collapse: true, viewed: false },
        path: 'src/renamed.ts',
        status: 'renamed',
      }),
      expect.objectContaining({
        capabilities: { collapse: true, viewed: false },
        path: 'assets/logo.bin',
        status: 'modified',
      }),
    ]);
  });

  it('binds a renamed file to its diff by the tree anchor', () => {
    replaceDocument(edgeCases);

    const snapshot = asSupported(scanPage(document));
    expect(snapshot.files.find((file) => file.path === 'src/renamed.ts')).toMatchObject({
      anchor: 'diff-renamed',
      capabilities: { collapse: true, viewed: false },
      status: 'renamed',
    });
    expect(snapshot.region('src/renamed.ts')?.id).toBe('diff-renamed');
    expect(snapshot.collapseControl('src/renamed.ts')).not.toBeNull();
  });

  it('keeps tree structure stable when only regions change', () => {
    const treeKey = treeStructureKey(document);
    const pageKey = pageStructureKey(document);
    expect(treeKey).toStrictEqual(treeStructureKey(document));
    expect(pageKey).toStrictEqual(pageStructureKey(document));

    document
      .querySelector(`#${diffApp} button[aria-label="Not Viewed"]`)
      ?.setAttribute('aria-label', 'Viewed');
    document
      .querySelector(`#${diffApp} button[aria-pressed="false"]`)
      ?.setAttribute('aria-pressed', 'true');
    expect(treeStructureKey(document)).toBe(treeKey);
    expect(pageStructureKey(document)).toBe(pageKey);

    const regionKey = regionStructureKey(document);
    document.getElementById('diff-config')?.remove();
    expect(treeStructureKey(document)).toBe(treeKey);
    expect(regionStructureKey(document)).not.toBe(regionKey);
    expect(pageStructureKey(document)).not.toBe(pageKey);
  });

  it('refreshes viewed facts without rebuilding file identity', () => {
    const snapshot = asSupported(scanPage(document));
    const file = requireApp(snapshot);
    expect(file.viewed).toBe(false);

    document
      .querySelector(`#${diffApp} button[aria-label="Not Viewed"]`)
      ?.setAttribute('aria-label', 'Viewed');
    document
      .querySelector(`#${diffApp} button[aria-pressed="false"]`)
      ?.setAttribute('aria-pressed', 'true');
    refreshObservedFiles(document, snapshot.files);

    expect(file.viewed).toBe(true);
    expect(file).toBe(snapshot.files.find((entry) => entry.path === appPath));
  });
});
