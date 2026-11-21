
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

    expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);
    expect(document.getElementById('docs')?.hidden).toBe(true);
    expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
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

    expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(true);
    expect(document.getElementById('docs')?.hidden).toBe(true);
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

    presenter.reset(snapshot);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBeUndefined();
    expect(click).not.toHaveBeenCalled();
  });

  it('shows again on teardown only the rows it hid', () => {
    const { snapshot, state, presenter } = excludingConfig();
    presenter.apply(snapshot, state);
    // GitHub hides a row on its own after the pass.
    const native = document.getElementById('src/app.ts');
    if (native) native.hidden = true;
    expect(document.getElementById('config/app.json')?.hidden).toBe(true);
    presenter.reset(snapshot);

    expect(document.getElementById('config/app.json')?.hidden).toBe(false);
    expect(native?.hidden).toBe(true);
  });

  it('hides a filtered-out file that has no collapse control', () => {
    document
      .querySelector('#diff-config button[aria-label="Collapse file"]')
      ?.remove();
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);

    expect(document.getElementById('config/app.json')?.hidden).toBe(true);
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
    expect(document.getElementById('docs/readme.md')?.hidden).toBe(false);
    expect(document.getElementById('docs')?.hidden).toBe(false);
  });
});
