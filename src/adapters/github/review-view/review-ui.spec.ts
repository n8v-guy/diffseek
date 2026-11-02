import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewedTarget } from '../review-page/viewed-actions';

import { replaceBody } from '../review-page/test-dom';
import {
  dismissSnackbar,
  removeInjected,
  showAlwaysRead,
  showBatchResult,
  showBatchStarted,
  showHideNow,
  showRememberedFilterDefault,
  showUnavailable,
} from './review-ui';

const couldNotMark = "Couldn't mark files viewed. Try again.";
const couldNotUnmark = "Couldn't unmark files. Try again.";
const snackbarSelector = '[data-diffseek="snackbar"]';

function noteShown(shown: string[]): void {
  const last = [
    ...document.querySelectorAll<HTMLElement>(snackbarSelector),
  ].at(-1);
  const text = last?.textContent;
  if (text !== undefined && text !== '') shown.push(text);
}

function press(target: Element | null | undefined): void {
  target?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function snackbars(): (null | string)[] {
  return [...document.querySelectorAll<HTMLElement>(snackbarSelector)].map(
    (item) => item.textContent,
  );
}

describe('review snackbar copy', () => {
  beforeEach(() => {
    replaceBody('<main></main>');
  });

  it('announces a snackbar in the live region', () => {
    showBatchStarted(document, 'folder', true);
    const stack = document.querySelector('[data-diffseek="snackbars"]');
    const snackbar = document.querySelector(snackbarSelector);
    expect(stack?.getAttribute('aria-live')).toBe('polite');
    expect(snackbar?.getAttribute('role')).toBe('status');
    expect(snackbar?.textContent).toBe(
      'Marking visible files in folder viewed…',
    );
  });

  it('gives every batch distinct messages, with no progress for a single file', () => {
    const done = { completed: ['a.ts'], failed: [], requested: 1 };
    const failed = { completed: [], failed: ['a.ts'], requested: 1 };
    const shown: string[] = [];
    const targets = ['file', 'folder', 'category', 'auto-view'] as const;
    for (const target of targets) recordTarget({ done, failed, shown, target });

    expect(shown).toStrictEqual([
      'File marked viewed',
      "Couldn't mark file viewed. Try again.",
      'File unmarked',
      "Couldn't unmark file. Try again.",
      'Marking visible files in folder viewed…',
      'Visible files in folder marked viewed',
      couldNotMark,
      'Unmarking visible files in folder…',
      'Visible files in folder unmarked',
      couldNotUnmark,
      'Marking all files in category viewed…',
      'All files in category marked viewed',
      couldNotMark,
      'Unmarking all files in category…',
      'All files in category unmarked',
      couldNotUnmark,
      'Auto-view: marking generated files viewed…',
      'Auto-view: generated files marked viewed',
      couldNotMark,
    ]);
  });

  it('starts the unavailable status with a capital', () => {
    replaceBody('<button aria-label="Filter options"></button>');
    showUnavailable(document, 'No file tree on this page');
    expect(document.querySelector('[data-diffseek="unavailable"]')?.textContent).toBe(
      'DiffSeek unavailable. No file tree on this page',
    );
  });
});

interface BatchSample {
  completed: string[];
  failed: string[];
  requested: number;
}

function recordTarget(sample: {
  done: BatchSample;
  failed: BatchSample;
  shown: string[];
  target: ViewedTarget;
}): void {
  const viewedStates = sample.target === 'auto-view' ? [true] : [true, false];
  for (const viewed of viewedStates) {
    if (showBatchStarted(document, sample.target, viewed)) {
      noteShown(sample.shown);
    }
    showBatchResult(document, sample.target, viewed, sample.done);
    noteShown(sample.shown);
    showBatchResult(document, sample.target, viewed, sample.failed);
    noteShown(sample.shown);
  }
}

describe('review snackbar lifetime', () => {
  beforeEach(() => {
    replaceBody('<main></main>');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns progress into its outcome in place, and a newer toast replaces it', () => {
    const progress = showBatchStarted(document, 'category', true);
    showHideNow(document);
    expect(snackbars()).toStrictEqual([
      'Marking all files in category viewed…',
      'Hidden',
    ]);

    showBatchResult(
      document,
      'category',
      true,
      {
        completed: ['src/ok.ts'],
        failed: ['src/app.ts', 'docs/readme.md'],
        requested: 3,
      },
      progress,
    );
    expect(snackbars()).toStrictEqual([couldNotMark]);
    expect(document.querySelector<HTMLElement>(snackbarSelector)?.title).toBe('');
    showAlwaysRead(document, false);
    expect(snackbars()).toStrictEqual(['Auto-view off']);
  });

  it('keeps a toast for the minimum time, then hides it on the next input', () => {
    vi.useFakeTimers();
    showHideNow(document);

    vi.advanceTimersByTime(4_999);
    press(document.body);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    document.body.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(snackbars()).toStrictEqual(['Hidden']);

    // Early input is not queued: the toast stays until input after the minimum.
    vi.advanceTimersByTime(1);
    expect(snackbars()).toStrictEqual(['Hidden']);
    document.body.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(document.querySelector('[data-diffseek="snackbars"]')).toBeNull();
  });

  it('restarts the minimum when progress turns into its outcome', () => {
    vi.useFakeTimers();
    const progress = showBatchStarted(document, 'folder', true);
    vi.advanceTimersByTime(10_000);
    press(document.body);
    expect(snackbars()).toStrictEqual(['Marking visible files in folder viewed…']);

    showBatchResult(
      document,
      'folder',
      true,
      { completed: ['a.ts', 'b.ts'], failed: [], requested: 2 },
      progress,
    );
    vi.advanceTimersByTime(4_999);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(snackbars()).toStrictEqual(['Visible files in folder marked viewed']);
    vi.advanceTimersByTime(1);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(snackbars()).toStrictEqual([]);
  });

  it('closes a clicked toast at once, progress included', () => {
    vi.useFakeTimers();
    press(showBatchStarted(document, 'folder', true));
    expect(document.querySelector('[data-diffseek="snackbars"]')).toBeNull();

    showHideNow(document);
    press(document.querySelector(snackbarSelector));
    expect(document.querySelector('[data-diffseek="snackbars"]')).toBeNull();
  });

  it('drops the progress toast of a batch with no outcome', () => {
    dismissSnackbar(showBatchStarted(document, 'folder', false));
    expect(document.querySelector('[data-diffseek="snackbars"]')).toBeNull();
  });
});

describe('review injected status', () => {
  beforeEach(() => {
    replaceBody('<main></main>');
  });

  it('removes injected actions without touching native file icons', () => {
    replaceBody(`
      <ul role="menu">
        <li data-diffseek-native-hidden="true" hidden>Native</li>
        <li data-diffseek="filters"></li>
      </ul>
      <span class="diffseek-viewed-icon-anchor" data-diffseek-viewed-action="true" aria-pressed="false" aria-label="Mark viewed" title="Mark viewed">
        <svg class="octicon"></svg>
      </span>
    `);

    removeInjected(document);

    expect(document.querySelector('[data-diffseek-viewed-action]')).toBeNull();
    expect(document.querySelector('svg.octicon')).not.toBeNull();
    expect(document.querySelector('span')?.attributes).toHaveLength(0);
    expect(document.querySelector('.diffseek-viewed-icon-anchor')).toBeNull();
    expect(document.querySelector('[data-diffseek-native-hidden]')).toBeNull();
    expect(document.querySelector('[role="menu"] li')?.hasAttribute('hidden')).toBe(
      false,
    );
  });

  it('announces remembered filter defaults entering and leaving', () => {
    showRememberedFilterDefault(document, 'hidden');
    showRememberedFilterDefault(document, 'shown');
    showHideNow(document);
    showAlwaysRead(document, true);
    showAlwaysRead(document, false);

    // Each newer toast replaces the one before it.
    expect(snackbars()).toStrictEqual(['Auto-view off']);
  });
});
