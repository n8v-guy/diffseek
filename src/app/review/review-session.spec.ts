import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';

import { startReviewApp } from './review-app';

const emptyMetadata = { codeowners: '', attributes: '' };

beforeEach(() => {
  fakeBrowser.reset();
  document.documentElement.innerHTML = fixture;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('review session stream batching', () => {
  it('updates a viewed toggle immediately and coalesces panel bursts', async () => {
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => emptyMetadata,
      refreshDefault: async () => ({ metadata: emptyMetadata, changed: false }),
      readPull: async (_review, fallback) => fallback,
    });
    let reconciles = 0;
    document.addEventListener('diffseek-reconciled', () => {
      reconciles += 1;
    });

    const viewed = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Not Viewed"]',
    );
    viewed?.setAttribute('aria-label', 'Viewed');
    viewed?.setAttribute('aria-pressed', 'true');
    await Promise.resolve();
    expect(reconciles).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(reconciles).toBe(1);
    expect(
      document
        .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Mark as not viewed');

    for (let index = 0; index < 5; index += 1) {
      const region = document.createElement('div');
      region.id = `diff-stream-${index}`;
      region.setAttribute('role', 'region');
      document.body.append(region);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(reconciles).toBe(1);
    await vi.advanceTimersByTimeAsync(53);
    expect(reconciles).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconciles).toBe(2);

    for (let index = 5; index < 8; index += 1) {
      const region = document.createElement('div');
      region.id = `diff-stream-${index}`;
      region.setAttribute('role', 'region');
      document.body.append(region);
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(63);
    expect(reconciles).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconciles).toBe(3);

    app.stop();
  });
});
