
import { beforeEach, describe, expect, it } from 'vitest';

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

function restoreOnClick(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    button.setAttribute('aria-label', 'Collapse file');
  });
}

describe('ReviewPresenter', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
    document.querySelector('[role="tree"]')?.insertAdjacentHTML(
      'afterbegin',
      '<li id="docs" role="treeitem" aria-label="docs"></li>',
    );
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

  it('collapses and mutes non-matching diffs, then restores its own changes', async () => {
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBe('true');
    expect(
      document
        .getElementById('diff-config')
        ?.querySelector('button')
        ?.getAttribute('aria-label'),
    ).toBe('Expand file');

    presenter.clear(snapshot);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBeUndefined();
    await untilDom(() => {
      expect(
        document
          .getElementById('diff-config')
          ?.querySelector('button')
          ?.getAttribute('aria-label'),
      ).toBe('Collapse file');
    });
  });

  it('preserves a file the user had already collapsed', () => {
    const { snapshot, state, presenter } = excludingConfig();
    snapshot
      .collapseControl('config/app.json')
      ?.setAttribute('aria-label', 'Expand file');

    presenter.apply(snapshot, state);
    presenter.clear(snapshot);

    expect(
      document
        .getElementById('diff-config')
        ?.querySelector('button')
        ?.getAttribute('aria-label'),
    ).toBe('Expand file');
  });

  it('does not claim a collapse that GitHub failed to apply', () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const collapse = snapshot.collapseControl('config/app.json');
    if (!collapse) throw new Error('Missing fixture binding');
    collapse.replaceWith(collapse.cloneNode(true));

    const { snapshot: rescanned, state, presenter } = excludingConfig();
    presenter.apply(rescanned, state);

    const ignoredButton = rescanned.collapseControl('config/app.json');
    ignoredButton?.addEventListener('click', () => {
      ignoredButton.setAttribute(
        'aria-label',
        ignoredButton.getAttribute('aria-label') === 'Collapse file'
          ? 'Expand file'
          : 'Collapse file',
      );
    });
    ignoredButton?.setAttribute('aria-label', 'Expand file');
    presenter.clear(rescanned);

    expect(ignoredButton?.getAttribute('aria-label')).toBe('Expand file');
  });

  it('owns and restores a collapse that GitHub commits asynchronously', async () => {
    const original = document.querySelector<HTMLButtonElement>(
      '#diff-config button[aria-label="Collapse file"]',
    );
    const delayed = original?.cloneNode(true) as HTMLButtonElement | undefined;
    original?.replaceWith(delayed!);
    delayed?.addEventListener('click', () => {
      queueMicrotask(() => {
        delayed.setAttribute(
          'aria-label',
          delayed.getAttribute('aria-label') === 'Collapse file'
            ? 'Expand file'
            : 'Collapse file',
        );
      });
    });
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);
    await Promise.resolve();
    expect(delayed?.getAttribute('aria-label')).toBe('Expand file');

    presenter.clear(snapshot);
    await untilDom(() => {
      expect(delayed?.getAttribute('aria-label')).toBe('Collapse file');
    });
  });

  it('confirms and restores through a GitHub-replaced collapse control', async () => {
    const original = document.querySelector<HTMLButtonElement>(
      '#diff-config button[aria-label="Collapse file"]',
    );
    const detached = original?.cloneNode(true) as HTMLButtonElement | undefined;
    original?.replaceWith(detached!);
    detached?.addEventListener('click', () => {
      setTimeout(() => {
        const replacement = detached.cloneNode(true) as HTMLButtonElement;
        replacement.setAttribute('aria-label', 'Expand file');
        restoreOnClick(replacement);
        detached.replaceWith(replacement);
      }, 0);
    });
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);
    await untilDom(() => {
      expect(
        document.querySelector(
          '#diff-config button[aria-label="Expand file"]',
        ),
      ).not.toBeNull();
    });
    presenter.clear(snapshot);
    await untilDom(() => {
      expect(
        document.querySelector(
          '#diff-config button[aria-label="Collapse file"]',
        ),
      ).not.toBeNull();
    });
  });

  it('reconciles when a user expands an actively filtered file', async () => {
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);
    await Promise.resolve();
    const button = document.querySelector<HTMLButtonElement>(
      '#diff-config button[aria-label="Expand file"]',
    );
    button?.click();
    expect(button?.getAttribute('aria-label')).toBe('Collapse file');

    presenter.apply(snapshot, state);
    await untilDom(() => {
      expect(button?.getAttribute('aria-label')).toBe('Expand file');
    });
  });

  it('does not re-click when a filtered file is already collapsed', async () => {
    const button = document.querySelector<HTMLButtonElement>(
      '#diff-config button[aria-label="Collapse file"]',
    );
    let clicks = 0;
    button?.addEventListener('click', () => {
      clicks += 1;
    });

    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);
    await untilDom(() => {
      expect(button?.getAttribute('aria-label')).toBe('Expand file');
    });
    expect(clicks).toBe(1);

    presenter.apply(snapshot, state);
    await Promise.resolve();
    expect(clicks).toBe(1);
    expect(button?.getAttribute('aria-label')).toBe('Expand file');
  });

  it('leaves an uncollapsible file visible when filters are active', () => {
    document
      .querySelector('#diff-config button[aria-label="Collapse file"]')
      ?.remove();
    const { snapshot, state, presenter } = excludingConfig();

    presenter.apply(snapshot, state);

    expect(document.getElementById('config/app.json')?.hidden).toBe(false);
    expect(
      document.getElementById('diff-config')?.dataset.diffseekFilteredOut,
    ).toBeUndefined();
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

/** Resolves once `check` stops throwing, re-checking on DOM mutations only; the timeout is a failure guard. */
async function untilDom(check: () => void, guardMs = 4_000): Promise<void> {
  let lastError: unknown;
  const passes = () => {
    try {
      check();
      return true;
    } catch (error) {
      lastError = error;
      return false;
    }
  };
  if (passes()) return;
  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!passes()) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(lastError instanceof Error ? lastError : new Error('untilDom: condition never held'));
    }, guardMs);
  });
}
