
import { beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';
import { scanPage } from '@diffseek/github/review-page/page-adapter';
import { markViewed } from '@diffseek/github/review-page/viewed-actions';

import { ViewedActionExecutor } from './action-executor';

describe('ViewedActionExecutor', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = fixture;
  });

  it('waits for UI paint before starting a queued command', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    let painted: (() => void) | undefined;
    const beforeExecute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          painted = resolve;
        }),
    );
    const markFiles = vi.fn().mockResolvedValue({
      requested: 1,
      completed: ['src/app.ts'],
      failed: [],
    });
    const executor = new ViewedActionExecutor({
      current: () => ({
        reviewKey: 'octo/repo#1',
        generation: 0,
        snapshot,
      }),
      beforeExecute,
      markFiles,
    });

    const result = executor.enqueue({
      reviewKey: 'octo/repo#1',
      generation: 0,
      viewed: true,
      paths: ['src/app.ts'],
    });
    await vi.waitFor(() => expect(beforeExecute).toHaveBeenCalledOnce());

    expect(markFiles).not.toHaveBeenCalled();
    painted?.();
    await result;

    expect(markFiles).toHaveBeenCalledOnce();
  });

  it('preserves opposing command order while GitHub commits asynchronously', async () => {
    const firstSnapshot = scanPage(document);
    if (!firstSnapshot.supported) throw new Error(firstSnapshot.reason);
    const button = firstSnapshot.viewedControl('src/app.ts');
    if (!button) throw new Error('Missing viewed control');

    let firstClicked: (() => void) | undefined;
    const clicked = new Promise<void>((resolve) => {
      firstClicked = resolve;
    });
    const nativeStates: boolean[] = [];
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-pressed') !== 'true';
      nativeStates.push(next);
      if (nativeStates.length === 1) {
        firstClicked?.();
        return;
      }
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Not Viewed');
    });

    const executor = new ViewedActionExecutor({
      current: () => {
        const snapshot = scanPage(document);
        return snapshot.supported
          ? { reviewKey: 'octo/repo#1', generation: 0, snapshot }
          : null;
      },
      markFiles: (snapshot, paths, viewed) =>
        markViewed(snapshot, paths, viewed, { timeoutMs: 50 }),
    });
    const mark = executor.enqueue({
      reviewKey: 'octo/repo#1',
      generation: 0,
      viewed: true,
      paths: ['src/app.ts'],
    });
    const unmark = executor.enqueue({
      reviewKey: 'octo/repo#1',
      generation: 0,
      viewed: false,
      paths: ['src/app.ts'],
    });

    await clicked;
    expect(nativeStates).toEqual([true]);
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', 'Viewed');
    await Promise.all([mark, unmark]);

    expect(nativeStates).toEqual([true, false]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Not Viewed');
  });

  it('skips a pending path superseded by a native action', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    let finishFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const markFiles = vi.fn(async (_snapshot, paths: string[]) => {
      if (paths[0] === 'src/app.ts') await firstPending;
      return {
        requested: paths.length,
        completed: paths,
        failed: [],
      };
    });
    const executor = new ViewedActionExecutor({
      current: () => ({
        reviewKey: 'octo/repo#1',
        generation: 0,
        snapshot,
      }),
      markFiles,
    });
    const result = executor.enqueue({
      reviewKey: 'octo/repo#1',
      generation: 0,
      viewed: true,
      paths: ['src/app.ts', 'src/new.ts'],
    });
    await vi.waitFor(() => expect(markFiles).toHaveBeenCalledOnce());

    executor.invalidate('src/new.ts');
    finishFirst?.();

    await expect(result).resolves.toMatchObject({
      requested: 2,
      completed: ['src/app.ts'],
      failed: [],
    });
    expect(markFiles).toHaveBeenCalledOnce();
  });

  it('cancels an active command and drops commands already queued behind it', async () => {
    const snapshot = scanPage(document);
    if (!snapshot.supported) throw new Error(snapshot.reason);
    const executor = new ViewedActionExecutor({
      current: () => ({
        reviewKey: 'octo/repo#1',
        generation: 0,
        snapshot,
      }),
      markFiles: async (_snapshot, paths, _viewed, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener(
            'abort',
            () =>
              resolve({
                requested: paths.length,
                completed: [],
                failed: [],
              }),
            { once: true },
          );
        }),
    });
    const active = executor.enqueue({
      reviewKey: 'octo/repo#1',
      generation: 0,
      viewed: true,
      paths: ['src/app.ts'],
    });
    const queued = executor.enqueue({
      reviewKey: 'octo/repo#1',
      generation: 0,
      viewed: false,
      paths: ['src/new.ts'],
    });

    await Promise.resolve();
    executor.cancel();

    await expect(active).resolves.toBeNull();
    await expect(queued).resolves.toBeNull();
  });
});
