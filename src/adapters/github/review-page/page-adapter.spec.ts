import { beforeEach, describe, expect, it } from 'vitest';

import edgeCases from './fixtures/github-pr-edge-cases.html?raw';
import fixture from './fixtures/github-pr.html?raw';
import {
  pageStructureKey,
  refreshObservedFiles,
  scanPage,
} from './page-adapter';

describe('scanPage', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
  });

  it('maps GitHub semantic DOM into normalized files', () => {
    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
    if (!snapshot.supported) return;

    expect(snapshot.files).toHaveLength(5);
    expect(snapshot.files.find((file) => file.path === 'src/new.ts')).toMatchObject({
      anchor: 'diff-new',
      extension: '.ts',
      status: 'added',
      viewed: false,
      capabilities: { collapse: true, viewed: true },
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
    document.body.innerHTML = '<main>GitHub changed</main>';

    expect(scanPage(document)).toEqual({
      supported: false,
      reason: 'File tree is unavailable',
    });
  });

  it('resolves native control names exposed through aria-labelledby', () => {
    const button = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Collapse file"]',
    );
    button?.removeAttribute('aria-label');
    button?.setAttribute('aria-labelledby', 'collapse-label');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<span id="collapse-label">Collapse file</span>',
    );

    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
  });

  it('discovers a diff inserted after the first scan', () => {
    expect(scanPage(document).supported).toBe(true);

    document.querySelector('[role="tree"]')?.insertAdjacentHTML(
      'beforeend',
      `
        <li id="src/lazy.ts" role="treeitem" aria-label="lazy.ts">
          <svg class="octicon octicon-file-diff"></svg>
          <a href="#diff-lazy">lazy.ts</a>
        </li>
      `,
    );
    document.body.insertAdjacentHTML(
      'beforeend',
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

    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
    if (!snapshot.supported) return;
    expect(snapshot.files.some((file) => file.path === 'src/lazy.ts')).toBe(true);
  });

  it('ignores nested folder treeitems that inherit a descendant file link', () => {
    const tree = document.querySelector('[role="tree"]');
    const file = document.getElementById('src/app.ts');
    const folder = document.createElement('li');
    const group = document.createElement('ul');
    folder.id = 'src';
    folder.setAttribute('role', 'treeitem');
    group.setAttribute('role', 'group');
    folder.append(group);
    group.append(file!);
    tree?.prepend(folder);

    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
    if (!snapshot.supported) return;
    expect(snapshot.files).toHaveLength(5);
    expect(snapshot.files.some((candidate) => candidate.path === 'src/app.ts')).toBe(
      true,
    );
  });

  it('keeps diff regions addressable when a collapsed folder unmounts file rows', () => {
    document.getElementById('src/app.ts')?.remove();

    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);

    expect(snapshot.files.some(({ path }) => path === 'src/app.ts')).toBe(false);
    expect(snapshot.region('src/app.ts')?.id).toBe('diff-app');
    expect(snapshot.viewedControl('src/app.ts')).not.toBeNull();
  });

  it('isolates a transient duplicate diff instead of disabling the review', () => {
    const region = document.getElementById('diff-app');
    region?.after(region.cloneNode(true));

    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
    if (!snapshot.supported) return;
    expect(snapshot.files.some((file) => file.path === 'src/app.ts')).toBe(false);
    expect(snapshot.unavailable.get('src/app.ts')).toBe(
      'Duplicate diff region',
    );
    expect(snapshot.files).toHaveLength(4);
  });

  it('keeps filtering available when only a viewed control is missing', () => {
    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.remove();

    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
    if (!snapshot.supported) return;
    expect(snapshot.files.some((file) => file.path === 'src/app.ts')).toBe(true);
    expect(snapshot.viewedControl('src/app.ts')).toBeNull();
    expect(
      snapshot.files.find((file) => file.path === 'src/app.ts')?.capabilities,
    ).toEqual({ collapse: true, viewed: false });
  });

  it('keeps a file observable when only its collapse control is missing', () => {
    document
      .querySelector('#diff-app button[aria-label="Collapse file"]')
      ?.remove();

    const snapshot = scanPage(document);
    expect(snapshot.supported).toBe(true);
    if (!snapshot.supported) return;
    expect(snapshot.files.some((file) => file.path === 'src/app.ts')).toBe(true);
    expect(snapshot.collapseControl('src/app.ts')).toBeNull();
  });

  it('owns live control resolution behind the semantic page interface', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const original = snapshot.viewedControl('src/app.ts');
    const replacement = original?.cloneNode(true) as HTMLButtonElement;
    original?.replaceWith(replacement);

    expect('bindings' in snapshot).toBe(false);
    expect(snapshot.viewedControl('src/app.ts')).toBe(replacement);
    expect(snapshot.collapseControl('src/app.ts')).not.toBeNull();
    expect(snapshot.treeItem('src/app.ts')?.id).toBe('src/app.ts');
  });

  it('covers deleted, renamed, binary, and alternative accessible-name contracts', () => {
    document.documentElement.innerHTML = edgeCases;

    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);

    expect(snapshot.files).toEqual([
      expect.objectContaining({
        path: 'src/removed.ts',
        status: 'deleted',
        capabilities: { collapse: true, viewed: true },
      }),
      expect.objectContaining({
        path: 'src/renamed.ts',
        status: 'renamed',
        capabilities: { collapse: true, viewed: false },
      }),
    ]);
    expect(snapshot.unavailable.get('assets/logo.bin')).toBe(
      'Incomplete diff structure',
    );
  });

  it('keeps a stable structure key until tree or region membership changes', () => {
    const first = pageStructureKey(document);
    expect(first).toEqual(pageStructureKey(document));

    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.setAttribute('aria-label', 'Viewed');
    document
      .querySelector('#diff-app button[aria-pressed="false"]')
      ?.setAttribute('aria-pressed', 'true');
    expect(pageStructureKey(document)).toBe(first);

    document.getElementById('diff-config')?.remove();
    expect(pageStructureKey(document)).not.toBe(first);
  });

  it('refreshes viewed facts without rebuilding file identity', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const file = snapshot.files.find((entry) => entry.path === 'src/app.ts');
    if (!file) throw new Error('missing file');
    expect(file.viewed).toBe(false);

    document
      .querySelector('#diff-app button[aria-label="Not Viewed"]')
      ?.setAttribute('aria-label', 'Viewed');
    document
      .querySelector('#diff-app button[aria-pressed="false"]')
      ?.setAttribute('aria-pressed', 'true');
    refreshObservedFiles(document, snapshot.files);

    expect(file.viewed).toBe(true);
    expect(file).toBe(
      snapshot.files.find((entry) => entry.path === 'src/app.ts'),
    );
  });
});
