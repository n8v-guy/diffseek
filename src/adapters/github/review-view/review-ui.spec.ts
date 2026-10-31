import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  removeInjected,
  showAlwaysRead,
  showAutoViewed,
  showBatchResult,
  showBatchStarted,
  showHideNow,
  showRememberedFilterDefault,
} from './review-ui';

describe('review status UI', () => {
  it('announces a viewed-scope snackbar in the live region', () => {
    document.body.innerHTML = '<main></main>';
    showBatchStarted(document, true, 8, { kind: 'folder', name: 'checkout' });
    const stack = document.querySelector('[data-diffseek="snackbars"]');
    const snackbar = document.querySelector('[data-diffseek="snackbar"]');
    expect(stack?.getAttribute('aria-live')).toBe('polite');
    expect(snackbar?.getAttribute('role')).toBe('status');
    expect(snackbar?.textContent).toBe(
      'Marking 8 visible files in checkout viewed…',
    );
  });

  afterEach(() => vi.useRealTimers());

  const snackbars = () => [
    ...document.querySelectorAll<HTMLElement>('[data-diffseek="snackbar"]'),
  ];
  const texts = () => snackbars().map((item) => item.textContent);

  it('stacks older snackbars above newer ones and expires each after seven seconds', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main></main>';

    showBatchStarted(document, true, 3);
    vi.advanceTimersByTime(1_000);
    showBatchResult(
      document,
      { requested: 3, completed: ['a.ts', 'b.ts', 'c.ts'], failed: [] },
      true,
    );

    expect(texts()).toEqual(['Marking 3 files viewed…', 'Marked 3 files viewed']);
    vi.advanceTimersByTime(6_000);
    expect(texts()).toEqual(['Marked 3 files viewed']);
    vi.advanceTimersByTime(1_000);
    expect(
      document.querySelector('[data-diffseek="snackbars"]'),
    ).toBeNull();
  });

  it('names a single file and skips its progress toast', () => {
    document.body.innerHTML = '<main></main>';

    showBatchStarted(document, true, 1);
    showBatchResult(
      document,
      { requested: 1, completed: ['src/Foo.tsx'], failed: [] },
      true,
    );
    showBatchStarted(document, false, 1);
    showBatchResult(
      document,
      { requested: 1, completed: ['src/Foo.tsx'], failed: [] },
      false,
    );
    showBatchStarted(document, false, 5);
    showBatchResult(
      document,
      { requested: 5, completed: ['1', '2', '3', '4', '5'], failed: [] },
      false,
    );

    expect(texts()).toEqual([
      'Marked Foo.tsx viewed',
      'Unmarked Foo.tsx',
      'Unmarking 5 files…',
      'Unmarked 5 files',
    ]);
  });

  it('uses the scoped completion instead of the generic batch result', () => {
    document.body.innerHTML = '<main></main>';
    const payments = { kind: 'category', name: 'payments', hidden: 3 } as const;

    showBatchStarted(document, true, 12, payments);
    showBatchResult(
      document,
      { requested: 12, completed: Array.from({ length: 12 }, () => 'a.ts'), failed: [] },
      true,
      payments,
    );
    showBatchStarted(document, false, 5, { kind: 'folder', name: 'payments' });
    showBatchResult(
      document,
      { requested: 5, completed: Array.from({ length: 5 }, () => 'a.ts'), failed: [] },
      false,
      { kind: 'folder', name: 'payments' },
    );

    expect(texts()).toEqual([
      'Marking all 12 payments files viewed (3 hidden)…',
      'Marked all 12 payments files viewed (3 hidden)',
      'Unmarking 5 visible files in payments…',
      'Unmarked 5 visible files in payments',
    ]);
  });

  it('keeps failures up for twelve seconds with reasons on hover', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main></main>';

    showBatchResult(
      document,
      {
        requested: 3,
        completed: ['src/ok.ts'],
        failed: [
          { path: 'src/app.ts', reason: 'control unavailable' },
          { path: 'docs/readme.md', reason: 'not confirmed' },
        ],
      },
      true,
      { kind: 'folder', name: 'src' },
    );
    showBatchResult(
      document,
      {
        requested: 2,
        completed: ['src/ok.ts'],
        failed: [{ path: 'src/app.ts', reason: 'not confirmed' }],
      },
      false,
    );
    showBatchResult(
      document,
      {
        requested: 2,
        completed: [],
        failed: [
          { path: 'src/a.ts', reason: 'not confirmed' },
          { path: 'src/b.ts', reason: 'not confirmed' },
        ],
      },
      true,
    );
    showBatchResult(
      document,
      {
        requested: 1,
        completed: [],
        failed: [{ path: 'src/Foo.tsx', reason: 'not confirmed' }],
      },
      false,
    );

    expect(texts()).toEqual([
      'Marked 1 of 3 files viewed; 2 failed. Hover for details',
      'Unmarked 1 of 2 files; 1 failed. Hover for details',
      "Couldn't mark 2 files viewed. Hover for details",
      "Couldn't unmark Foo.tsx. Hover for details",
    ]);
    expect(snackbars()[0]?.title).toBe(
      'src/app.ts: control unavailable\ndocs/readme.md: not confirmed',
    );
    vi.advanceTimersByTime(11_000);
    expect(snackbars()).toHaveLength(4);
    vi.advanceTimersByTime(1_000);
    expect(snackbars()).toHaveLength(0);
  });

  it('announces auto-viewed generated files once they are done', () => {
    document.body.innerHTML = '<main></main>';

    showAutoViewed(document, { requested: 0, completed: [], failed: [] });
    showAutoViewed(document, {
      requested: 8,
      completed: ['1', '2', '3', '4', '5', '6', '7', '8'],
      failed: [],
    });
    showAutoViewed(document, {
      requested: 1,
      completed: ['dist/app.js'],
      failed: [],
    });
    showAutoViewed(document, {
      requested: 2,
      completed: ['dist/app.js'],
      failed: [{ path: 'dist/app.css', reason: 'not confirmed' }],
    });

    expect(texts()).toEqual([
      'Auto-viewed 8 generated files',
      'Auto-viewed 1 generated file',
      'Marked 1 of 2 files viewed; 1 failed. Hover for details',
    ]);
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

    showRememberedFilterDefault(document, 'viewed', 'hidden');
    showRememberedFilterDefault(document, 'generated', 'shown');
    showHideNow(document, 'generated');
    showAlwaysRead(document, true);
    showAlwaysRead(document, false);

    expect(
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-diffseek="snackbar"]',
        ),
      ].map((item) => item.textContent),
    ).toEqual([
      'Viewed: Always hide',
      'Generated: Show now',
      'Generated: Hide now',
      'Auto-view on: generated files get marked viewed',
      'Auto-view off',
    ]);
  });
});
