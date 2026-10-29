import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  removeInjected,
  showAlwaysRead,
  showBatchResult,
  showBatchStarted,
  showHideNow,
  showRememberedFilterDefault,
  showViewedScope,
} from './review-ui';

describe('review status UI', () => {
  it('announces a viewed-scope snackbar in the live region', () => {
    document.body.innerHTML = '<main></main>';
    showViewedScope(document, 'Marked 8 visible files in checkout viewed');
    const stack = document.querySelector('[data-diffseek="snackbars"]');
    const snackbar = document.querySelector('[data-diffseek="snackbar"]');
    expect(stack?.getAttribute('aria-live')).toBe('polite');
    expect(snackbar?.getAttribute('role')).toBe('status');
    expect(snackbar?.textContent).toBe(
      'Marked 8 visible files in checkout viewed',
    );
  });

  afterEach(() => vi.useRealTimers());

  it('stacks older snackbars above newer ones and expires each after seven seconds', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main></main>';

    showBatchStarted(document, true, 3);
    vi.advanceTimersByTime(1_000);

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
    );

    const snackbars = () => [
      ...document.querySelectorAll<HTMLElement>('[data-diffseek="snackbar"]'),
    ];
    expect(snackbars().map((item) => item.textContent)).toEqual([
      'Marking 3 files as viewed…',
      'Marked 1 file as viewed; 2 failed',
    ]);
    expect(snackbars()[1]?.title).toContain(
      'src/app.ts: control unavailable',
    );

    vi.advanceTimersByTime(6_000);
    expect(snackbars().map((item) => item.textContent)).toEqual([
      'Marked 1 file as viewed; 2 failed',
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

    showRememberedFilterDefault(document, 'viewed', 'hidden');
    showRememberedFilterDefault(document, 'generated', 'shown');
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
      'Always hide',
      'Show now',
      'Hide now',
      'Always mark generated files viewed',
      'Stop marking generated files viewed',
    ]);
  });
});
