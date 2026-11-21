
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyFacetExclusions } from '@diffseek/review';
import type { FilterState } from '@diffseek/review';

import fixture from '../review-page/fixtures/github-pr.html?raw';
import { scanPage } from '../review-page/page-adapter';

import { ReviewPresenter } from './presenter';

const filters = (): FilterState => emptyFacetExclusions();

function excludingConfig() {
  const snapshot = scanPage(document);
  if (!snapshot.supported) throw new Error(snapshot.reason);
  snapshot.files
    .find((file) => file.path === 'config/app.json')
    ?.labels.push({ facet: 'groups', value: 'Config' });
  const state = filters();
  state.get('groups')?.add('Config');
  return { snapshot, state, presenter: new ReviewPresenter() };
}


function filteredOut(id: string): boolean {
  const row = document.getElementById(id);
  if (row == null) throw new Error(`Missing tree row ${id}`);
  return row.dataset.diffseekFilteredOut === 'true';
}

describe('ReviewPresenter', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
    document.querySelector('[role="tree"]')?.insertAdjacentHTML(
      'afterbegin',
      '<li id="docs" role="treeitem" aria-label="docs"></li>',
    );
  });

  it('hides a folder once every file under it is viewed and hidden', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    snapshot.files
      .find((file) => file.path === 'docs/readme.md')
      ?.labels.push({ facet: 'viewed', value: 'true' });
    const state = filters();
    state.get('viewed')?.add('true');

    new ReviewPresenter().apply(snapshot, state);

    expect(filteredOut('docs/readme.md')).toBe(true);
    expect(filteredOut('docs')).toBe(true);
    expect(filteredOut('src/app.ts')).toBe(false);
  });

  it('hides non-matching tree rows and empty folders', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    snapshot.files
      .find((file) => file.path === 'docs/readme.md')
      ?.labels.push({ facet: 'groups', value: 'Docs' });

    const state = filters();
    state.get('groups')?.add('Docs');
    new ReviewPresenter().apply(snapshot, state);

    expect(filteredOut('src/app.ts')).toBe(false);
    expect(filteredOut('docs/readme.md')).toBe(true);
    expect(filteredOut('docs')).toBe(true);
  });

  it('hides non-matching diffs without clicking GitHub, then shows them again', () => {
    const collapse = document.querySelector<HTMLButtonElement>(
      '#diff-config button[aria-label="Collapse file"]',
    );
    const click = vi.fn();
    collapse?.addEventListener('click', click);
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBe('true');

    presenter.reset(document);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBeUndefined();
    expect(click).not.toHaveBeenCalled();
  });

  it('removes its attribute on teardown and leaves GitHub hidden rows alone', () => {
    const { snapshot, state, presenter } = excludingConfig();
    presenter.apply(snapshot, state);
    // GitHub hides a row on its own after the pass.
    const native = document.getElementById('src/app.ts');
    if (native) native.hidden = true;
    expect(filteredOut('config/app.json')).toBe(true);
    presenter.reset(document);

    expect(filteredOut('config/app.json')).toBe(false);
    expect(native?.hidden).toBe(true);
  });

  it('hides a filtered-out file that has no collapse control', () => {
    document
      .querySelector('#diff-config button[aria-label="Collapse file"]')
      ?.remove();
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);

    expect(filteredOut('config/app.json')).toBe(true);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBe('true');
  });

  it('keeps a folder visible when it contains an unavailable descendant', () => {
    document
      .getElementById('docs/readme.md')
      ?.querySelector('a[href^="#diff-"]')
      ?.setAttribute('href', '#diff-');
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);

    expect(snapshot.unavailable.get('docs/readme.md')).toBe('Invalid diff anchor');
    expect(filteredOut('docs/readme.md')).toBe(false);
    expect(filteredOut('docs')).toBe(false);
  });

  it('clears the marker on a tree that was detached before teardown', () => {
    const { snapshot, state, presenter } = excludingConfig();
    presenter.apply(snapshot, state);
    const tree = snapshot.tree();
    const host = tree?.parentElement;
    expect(filteredOut('config/app.json')).toBe(true);
    tree?.remove();
    presenter.reset(document);
    if (tree) host?.append(tree);
    expect(filteredOut('config/app.json')).toBe(false);
  });

  it('shows a tree row again when its panel is no longer unique', () => {
    const { snapshot, state, presenter } = excludingConfig();
    presenter.apply(snapshot, state);
    expect(filteredOut('config/app.json')).toBe(true);
    const region = document.getElementById('diff-config');
    region?.after(region.cloneNode(true));
    const next = scanPage(document);
    if (!next.supported) throw new Error(next.reason);
    presenter.apply(next, filters());
    expect(filteredOut('config/app.json')).toBe(false);
  });
});
