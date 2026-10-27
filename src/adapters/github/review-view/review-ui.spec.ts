import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  removeInjected,
  showBatchResult,
  showBatchStarted,
  showRememberedFilterDefault,
} from './review-ui';

describe('review status UI', () => {
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
    showRememberedFilterDefault(
      document,
      'generated',
      'hidden-viewed',
    );

    expect(
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-diffseek="snackbar"]',
        ),
      ].map((item) => item.textContent),
    ).toEqual([
      'Hide viewed files by default',
      'Show generated files by default',
      'Hide and mark viewed generated files by default',
    ]);
  });
});
