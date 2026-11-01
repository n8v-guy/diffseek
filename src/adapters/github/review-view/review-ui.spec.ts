import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  removeInjected,
  showAlwaysRead,
  showBatchResult,
  showBatchStarted,
  showHideNow,
  showRememberedFilterDefault,
  showUnavailable,
} from './review-ui';

describe('review status UI', () => {
  it('announces a snackbar in the live region', () => {
    document.body.innerHTML = '<main></main>';
    showBatchStarted(document, 'folder', true);
    const stack = document.querySelector('[data-diffseek="snackbars"]');
    const snackbar = document.querySelector('[data-diffseek="snackbar"]');
    expect(stack?.getAttribute('aria-live')).toBe('polite');
    expect(snackbar?.getAttribute('role')).toBe('status');
    expect(snackbar?.textContent).toBe(
      'Marking visible files in folder viewed…',
    );
  });

  it('gives every batch a distinct progress, done, and retry message', () => {
    document.body.innerHTML = '<main></main>';
    const done = { requested: 1, completed: ['a.ts'], failed: [] };
    const failed = { requested: 1, completed: [], failed: ['a.ts'] };
    for (const target of ['file', 'folder', 'category', 'auto-view'] as const) {
      for (const viewed of target === 'auto-view' ? [true] : [true, false]) {
        showBatchStarted(document, target, viewed);
        showBatchResult(document, target, viewed, done);
        showBatchResult(document, target, viewed, failed);
      }
    }

    expect(
      [
        ...document.querySelectorAll<HTMLElement>('[data-diffseek="snackbar"]'),
      ].map((item) => item.textContent),
    ).toEqual([
      'Marking file viewed…',
      'File marked viewed',
      "Couldn't mark file viewed. Try again.",
      'Unmarking file…',
      'File unmarked',
      "Couldn't unmark file. Try again.",
      'Marking visible files in folder viewed…',
      'Visible files in folder marked viewed',
      "Couldn't mark files viewed. Try again.",
      'Unmarking visible files in folder…',
      'Visible files in folder unmarked',
      "Couldn't unmark files. Try again.",
      'Marking all files in category viewed…',
      'All files in category marked viewed',
      "Couldn't mark files viewed. Try again.",
      'Unmarking all files in category…',
      'All files in category unmarked',
      "Couldn't unmark files. Try again.",
      'Auto-view: marking generated files viewed…',
      'Auto-view: generated files marked viewed',
      "Couldn't mark files viewed. Try again.",
    ]);
  });

  it('starts the unavailable status with a capital', () => {
    document.body.innerHTML =
      '<button aria-label="Filter options"></button>';
    showUnavailable(document, 'No file tree on this page');
    expect(
      document.querySelector('[data-diffseek="unavailable"]')?.textContent,
    ).toBe('DiffSeek unavailable. No file tree on this page');
  });

  afterEach(() => vi.useRealTimers());

  it('stacks older snackbars above newer ones and expires each after seven seconds', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main></main>';

    showBatchStarted(document, 'category', true);
    vi.advanceTimersByTime(1_000);

    showBatchResult(document, 'category', true, {
      requested: 3,
      completed: ['src/ok.ts'],
      failed: ['src/app.ts', 'docs/readme.md'],
    });

    const snackbars = () => [
      ...document.querySelectorAll<HTMLElement>('[data-diffseek="snackbar"]'),
    ];
    expect(snackbars().map((item) => item.textContent)).toEqual([
      'Marking all files in category viewed…',
      "Couldn't mark files viewed. Try again.",
    ]);
    expect(snackbars()[1]?.title).toBe('');

    vi.advanceTimersByTime(6_000);
    expect(snackbars().map((item) => item.textContent)).toEqual([
      "Couldn't mark files viewed. Try again.",
    ]);
    vi.advanceTimersByTime(1_000);
    expect(
      document.querySelector('[data-diffseek="snackbars"]'),
    ).toBeNull();
  });

  it('removes injected actions without touching native file icons', () => {
    document.body.innerHTML = `
      <ul role="menu">
        <li data-diffseek-native-hidden="true" hidden>Native</li>
        <li data-diffseek="filters"></li>
      </ul>
      <span class="diffseek-viewed-icon-anchor" data-diffseek-viewed-action="true" aria-pressed="false" aria-label="Mark as viewed" title="Mark as viewed">
        <svg class="octicon"></svg>
      </span>
    `;

    removeInjected(document);

    expect(document.querySelector('[data-diffseek-viewed-action]')).toBeNull();
    expect(document.querySelector('svg.octicon')).not.toBeNull();
    expect(document.querySelector('span')?.attributes).toHaveLength(0);
    expect(
      document.querySelector('.diffseek-viewed-icon-anchor'),
    ).toBeNull();
    expect(
      document.querySelector('[data-diffseek-native-hidden]'),
    ).toBeNull();
    expect(document.querySelector('[role="menu"] li')?.hasAttribute('hidden')).toBe(
      false,
    );
  });

  it('announces remembered filter defaults entering and leaving', () => {
    document.body.innerHTML = '<main></main>';

    showRememberedFilterDefault(document, 'hidden');
    showRememberedFilterDefault(document, 'shown');
    showHideNow(document);
    showAlwaysRead(document, true);
    showAlwaysRead(document, false);

    expect(
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-diffseek="snackbar"]',
        ),
      ].map((item) => item.textContent),
    ).toEqual([
      'Files hidden on every PR',
      'Files shown',
      'Files hidden on this page',
      'Auto-view on: generated files get marked viewed',
      'Auto-view off',
    ]);
  });
});
