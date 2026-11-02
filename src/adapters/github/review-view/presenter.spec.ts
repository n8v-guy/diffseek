import type { FileLabel, FilterState } from '@diffseek/review';

import { emptyFacetExclusions } from '@diffseek/review';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PageSnapshot } from '../review-page/page-adapter';

import fixture from '../review-page/fixtures/github-pr.html?raw';
import { parseFragment, replaceDocument, requireSupported } from '../review-page/test-dom';
import { ReviewPresenter } from './presenter';

const ariaLabel = 'aria-label';
const collapseFile = 'Collapse file';
const configPath = 'config/app.json';
const diffConfig = 'diff-config';
const docsPath = 'docs';
const expandFile = 'Expand file';
const readmePath = 'docs/readme.md';
const domGuardMs = 4_000;

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

function buttonLabel(): null | string | undefined {
  return document
    .getElementById(diffConfig)
    ?.querySelector('button')
    ?.getAttribute(ariaLabel);
}

function configButton(label: string): HTMLButtonElement {
  const selector = `#${diffConfig} button[aria-label="${label}"]`;
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  return button;
}

function deferToggle(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    queueMicrotask(() => {
      toggleCollapse(button);
    });
  });
}

function excludingConfig(): {
  presenter: ReviewPresenter;
  snapshot: SupportedSnapshot;
  state: FilterState;
} {
  const snapshot = requireSupported();
  labelFile(snapshot, configPath, { facet: 'groups', value: 'Config' });
  const state = emptyFacetExclusions();
  state.get('groups')?.add('Config');
  return { presenter: new ReviewPresenter(), snapshot, state };
}

function labelFile(
  snapshot: SupportedSnapshot,
  path: string,
  label: FileLabel,
): void {
  const file = snapshot.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`Missing ${path}`);
  file.labels.push(label);
}

function loadPresenter(): void {
  replaceDocument(fixture);
  const tree = document.querySelector('[role="tree"]');
  if (!tree) throw new Error('Missing tree');
  tree.prepend(
    parseFragment(
      `<li id="${docsPath}" role="treeitem" aria-label="${docsPath}"></li>`,
    ),
  );
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${CSS.escape(collapseFile)}"], button[aria-label="${CSS.escape(expandFile)}"]`,
  )) {
    button.addEventListener('click', () => {
      toggleCollapse(button);
    });
  }
}

function replaceCollapsedControl(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    setTimeout(() => {
      const replacement = button.cloneNode(true);
      if (!(replacement instanceof HTMLButtonElement)) return;
      replacement.setAttribute(ariaLabel, expandFile);
      restoreOnClick(replacement);
      button.replaceWith(replacement);
    }, 0);
  });
}

function replaceWithClone(button: HTMLButtonElement): HTMLButtonElement {
  const clone = button.cloneNode(true);
  if (!(clone instanceof HTMLButtonElement)) {
    throw new TypeError('Missing control');
  }
  button.replaceWith(clone);
  return clone;
}

function requireCollapse(): HTMLButtonElement {
  const collapse = requireSupported().collapseControl(configPath);
  if (!collapse) throw new Error('Missing fixture binding');
  return collapse;
}

function restoreOnClick(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    button.setAttribute(ariaLabel, collapseFile);
  });
}

function toggleCollapse(button: HTMLButtonElement): void {
  button.setAttribute(
    ariaLabel,
    button.getAttribute(ariaLabel) === collapseFile ? expandFile : collapseFile,
  );
}

/** Resolves once `check` stops throwing, re-checking on DOM mutations only; the timeout is a failure guard. */
async function untilDom(check: () => void): Promise<void> {
  let lastError: unknown;
  const passes = (): boolean => {
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
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      const error = lastError instanceof Error
        ? lastError
        : new Error('untilDom: condition never held');
      reject(error);
    }, domGuardMs);
  });
}

function watchIgnored(button: HTMLButtonElement | null): void {
  if (!button) return;
  button.addEventListener('click', () => {
    toggleCollapse(button);
  });
}

describe('ReviewPresenter hiding', () => {
  beforeEach(loadPresenter);

  it('hides a folder once every file under it is viewed and hidden', () => {
    const snapshot = requireSupported();
    labelFile(snapshot, readmePath, { facet: 'viewed', value: 'true' });
    const state = emptyFacetExclusions();
    state.get('viewed')?.add('true');

    new ReviewPresenter().apply(snapshot, state);

    expect(document.getElementById(readmePath)?.hidden).toBe(true);
    expect(document.getElementById(docsPath)?.hidden).toBe(true);
    expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
  });

  it('hides non-matching tree rows and empty folders', () => {
    const snapshot = requireSupported();
    labelFile(snapshot, readmePath, { facet: 'groups', value: 'Docs' });
    const state = emptyFacetExclusions();
    state.get('groups')?.add('Docs');
    new ReviewPresenter().apply(snapshot, state);

    expect(document.getElementById('src/app.ts')?.hidden).toBe(false);
    expect(document.getElementById(readmePath)?.hidden).toBe(true);
    expect(document.getElementById(docsPath)?.hidden).toBe(true);
  });

  it('leaves an uncollapsible file visible when filters are active', () => {
    document
      .querySelector(`#${diffConfig} button[aria-label="${CSS.escape(collapseFile)}"]`)
      ?.remove();
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);

    expect(document.getElementById(configPath)?.hidden).toBe(false);
    expect(
      (document.getElementById(diffConfig))?.dataset['diffseekFilteredOut'],
    ).toBeUndefined();
  });

  it('keeps a folder visible when it contains an unavailable descendant', () => {
    document
      .getElementById(readmePath)
      ?.querySelector('a[href^="#diff-"]')
      ?.setAttribute('href', '#diff-');
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);

    expect(snapshot.unavailable.get(readmePath)).toBe('Invalid diff anchor');
    expect(document.getElementById(readmePath)?.hidden).toBe(false);
    expect(document.getElementById(docsPath)?.hidden).toBe(false);
  });
});

describe('ReviewPresenter collapse', () => {
  beforeEach(loadPresenter);

  it('collapses and mutes non-matching diffs, then restores its own changes', async () => {
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);
    expect((document.getElementById(diffConfig))?.dataset['diffseekFilteredOut']).toBe(
      'true',
    );
    expect(buttonLabel()).toBe(expandFile);

    presenter.clear(snapshot);
    expect(
      (document.getElementById(diffConfig))?.dataset['diffseekFilteredOut'],
    ).toBeUndefined();
    await untilDom(() => {
      expect(buttonLabel()).toBe(collapseFile);
    });
  });

  it('preserves a file the user had already collapsed', () => {
    const { presenter, snapshot, state } = excludingConfig();
    snapshot.collapseControl(configPath)?.setAttribute(ariaLabel, expandFile);

    presenter.apply(snapshot, state);
    presenter.clear(snapshot);

    expect(buttonLabel()).toBe(expandFile);
  });

  it('does not claim a collapse that GitHub failed to apply', () => {
    const collapse = requireCollapse();
    collapse.replaceWith(collapse.cloneNode(true));

    const { presenter, snapshot, state } = excludingConfig();
    presenter.apply(snapshot, state);

    const ignoredButton = snapshot.collapseControl(configPath);
    watchIgnored(ignoredButton);
    ignoredButton?.setAttribute(ariaLabel, expandFile);
    presenter.clear(snapshot);

    expect(ignoredButton?.getAttribute(ariaLabel)).toBe(expandFile);
  });

  it('does not re-click when a filtered file is already collapsed', async () => {
    const button = configButton(collapseFile);
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);
    await untilDom(() => {
      expect(button.getAttribute(ariaLabel)).toBe(expandFile);
    });
    expect(clicks).toBe(1);

    presenter.apply(snapshot, state);
    await Promise.resolve();
    expect(clicks).toBe(1);
    expect(button.getAttribute(ariaLabel)).toBe(expandFile);
  });
});

describe('ReviewPresenter async collapse', () => {
  beforeEach(loadPresenter);

  it('owns and restores a collapse that GitHub commits asynchronously', async () => {
    const original = configButton(collapseFile);
    const delayed = replaceWithClone(original);
    deferToggle(delayed);
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);
    await Promise.resolve();
    expect(delayed.getAttribute(ariaLabel)).toBe(expandFile);

    presenter.clear(snapshot);
    await untilDom(() => {
      expect(delayed.getAttribute(ariaLabel)).toBe(collapseFile);
    });
  });

  it('confirms and restores through a GitHub-replaced collapse control', async () => {
    const original = configButton(collapseFile);
    const detached = replaceWithClone(original);
    replaceCollapsedControl(detached);
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);
    await untilDom(() => {
      expect(
        document.querySelector(`#${diffConfig} button[aria-label="${CSS.escape(expandFile)}"]`),
      ).not.toBeNull();
    });
    presenter.clear(snapshot);
    await untilDom(() => {
      expect(
        document.querySelector(
          `#${diffConfig} button[aria-label="${CSS.escape(collapseFile)}"]`,
        ),
      ).not.toBeNull();
    });
  });

  it('reconciles when a user expands an actively filtered file', async () => {
    const { presenter, snapshot, state } = excludingConfig();

    presenter.apply(snapshot, state);
    await Promise.resolve();
    const button = configButton(expandFile);
    button.click();
    expect(button.getAttribute(ariaLabel)).toBe(collapseFile);

    presenter.apply(snapshot, state);
    await untilDom(() => {
      expect(button.getAttribute(ariaLabel)).toBe(expandFile);
    });
  });
});
