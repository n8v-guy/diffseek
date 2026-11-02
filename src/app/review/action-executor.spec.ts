import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';
import {
  type PageSnapshot,
  scanPage,
} from '@diffseek/github/review-page/page-adapter';
import {
  type ActionResult,
  markViewed,
} from '@diffseek/github/review-page/viewed-actions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewedActionExecutor, type ViewedCommand } from './action-executor';
import { replaceBody } from './review-app.fixture';

const reviewKey = 'octo/repo#1';
const appPath = 'src/app.ts';
const newPath = 'src/new.ts';

type MarkFiles = typeof markViewed;
type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

describe('ViewedActionExecutor', () => {
  beforeEach((): void => {
    replaceBody(fixture);
  });

  it('waits for UI paint before starting a queued command', waitsForPaint);
  it('preserves opposing command order while GitHub commits asynchronously', preservesCommandOrder);
  it('skips a pending path superseded by a native action', skipsSupersededPath);
  it('cancels an active command and drops commands already queued behind it', cancelsQueuedCommands);
});

async function cancelsQueuedCommands(): Promise<void> {
  const snapshot = supportedSnapshot(scanPage(document));
  const executor = new ViewedActionExecutor({
    current: (): { generation: number; reviewKey: string; snapshot: SupportedSnapshot } => ({
      generation: 0,
      reviewKey,
      snapshot,
    }),
    markFiles: (_snapshot, paths, _viewed, options): Promise<ActionResult> =>
      new Promise((resolve) => {
        options?.signal?.addEventListener('abort', (): void => {
          resolve(marked(paths, []));
        }, { once: true });
      }),
  });
  const active = executor.enqueue(command([appPath], true));
  const queued = executor.enqueue(command([newPath], false));
  await Promise.resolve();
  executor.cancel();
  await expect(active).resolves.toBeNull();
  await expect(queued).resolves.toBeNull();
}

function command(paths: string[], viewed: boolean): ViewedCommand {
  return { generation: 0, paths, reviewKey, viewed };
}

function holdFirstPath(pending: Promise<undefined>, started: () => void): MarkFiles {
  return async (_snapshot, paths): Promise<ActionResult> => {
    started();
    if (paths[0] === appPath) await pending;
    return marked(paths);
  };
}

function marked(paths: string[], completed: string[] = paths): ActionResult {
  return { completed, failed: [], requested: paths.length };
}

async function preservesCommandOrder(): Promise<void> {
  const firstSnapshot = supportedSnapshot(scanPage(document));
  const button = viewedButton(firstSnapshot, appPath);
  const clicked = Promise.withResolvers<undefined>();
  const nativeStates: boolean[] = [];
  button.addEventListener('click', (): void => {
    recordNativePress(button, nativeStates, (): void => { clicked.resolve(undefined); });
  });
  const executor = new ViewedActionExecutor({
    current: (): null | { generation: number; reviewKey: string; snapshot: SupportedSnapshot } => {
      const snapshot = scanPage(document);
      return snapshot.supported
        ? { generation: 0, reviewKey, snapshot }
        : null;
    },
    markFiles: (snapshot, paths, viewed): Promise<ActionResult> =>
      markViewed(snapshot, paths, viewed, { timeoutMs: 50 }),
  });
  const mark = executor.enqueue(command([appPath], true));
  const unmark = executor.enqueue(command([appPath], false));
  await clicked.promise;
  expect(nativeStates).toStrictEqual([true]);
  button.setAttribute('aria-pressed', 'true');
  button.setAttribute('aria-label', 'Viewed');
  await Promise.all([mark, unmark]);
  expect(nativeStates).toStrictEqual([true, false]);
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.getAttribute('aria-label')).toBe('Not Viewed');
}

function recordNativePress(
  button: HTMLButtonElement,
  nativeStates: boolean[],
  firstClicked: () => void,
): void {
  const next = button.getAttribute('aria-pressed') !== 'true';
  nativeStates.push(next);
  if (nativeStates.length === 1) {
    firstClicked();
    return;
  }
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'Not Viewed');
}

async function skipsSupersededPath(): Promise<void> {
  const snapshot = supportedSnapshot(scanPage(document));
  const firstPending = Promise.withResolvers<undefined>();
  const firstCall = Promise.withResolvers<undefined>();
  const seen: { signal?: AbortSignal } = {};
  const markFiles = vi.fn<MarkFiles>(async (_snapshot, paths, _viewed, options): Promise<ActionResult> => {
    if (options?.signal !== undefined) seen.signal = options.signal;
    return holdFirstPath(firstPending.promise, (): void => {
      firstCall.resolve(undefined);
    })(_snapshot, paths, true, options);
  });
  const executor = new ViewedActionExecutor({
    current: (): { generation: number; reviewKey: string; snapshot: SupportedSnapshot } => ({
      generation: 0,
      reviewKey,
      snapshot,
    }),
    markFiles,
  });
  const result = executor.enqueue(command([appPath, newPath], true));
  await firstCall.promise;
  expect(markFiles).toHaveBeenCalledExactlyOnceWith(snapshot, [appPath], true, {
    signal: seen.signal,
  });
  executor.invalidate(newPath);
  firstPending.resolve(undefined);
  await expect(result).resolves.toMatchObject({
    completed: [appPath],
    failed: [],
    requested: 2,
  });
  expect(markFiles).toHaveBeenCalledExactlyOnceWith(snapshot, [appPath], true, {
    signal: seen.signal,
  });
}

function supportedSnapshot(snapshot: PageSnapshot): SupportedSnapshot {
  if (!snapshot.supported) throw new Error(snapshot.reason);
  return snapshot;
}

function viewedButton(snapshot: SupportedSnapshot, path: string): HTMLButtonElement {
  const button = snapshot.viewedControl(path);
  if (button === null) throw new Error('Missing viewed control');
  return button;
}

async function waitsForPaint(): Promise<void> {
  const snapshot = supportedSnapshot(scanPage(document));
  const painted = Promise.withResolvers<undefined>();
  const executeStarted = Promise.withResolvers<undefined>();
  const beforeExecute = vi.fn<() => Promise<void>>(async () => {
    executeStarted.resolve(undefined);
    await painted.promise;
  });
  const seen: { signal?: AbortSignal } = {};
  const markFiles = vi.fn<MarkFiles>((_snapshot, _paths, _viewed, options): Promise<ActionResult> => {
    if (options?.signal !== undefined) seen.signal = options.signal;
    return Promise.resolve(marked([appPath]));
  });
  const executor = new ViewedActionExecutor({
    beforeExecute,
    current: (): { generation: number; reviewKey: string; snapshot: SupportedSnapshot } => ({
      generation: 0,
      reviewKey,
      snapshot,
    }),
    markFiles,
  });

  const result = executor.enqueue(command([appPath], true));
  await executeStarted.promise;
  expect(beforeExecute).toHaveBeenCalledExactlyOnceWith();
  expect(markFiles).not.toHaveBeenCalled();
  painted.resolve(undefined);
  await result;
  expect(markFiles).toHaveBeenCalledExactlyOnceWith(snapshot, [appPath], true, {
    signal: seen.signal,
  });
}
