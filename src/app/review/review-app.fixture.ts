import type { markViewed } from '@diffseek/github/review-page/viewed-actions';
import type { ReviewRef } from '@diffseek/github/routing/page-route';
import type {
  RepositoryMetadata,
  RepositoryRef,
} from '@diffseek/repository-metadata';

import fixtureHtml from '@diffseek/github/review-page/fixtures/github-pr.html?raw';
import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { type ReviewApp, startReviewApp } from './review-app';

export type DefaultRefresher = (
  repository: RepositoryRef,
) => Promise<{ changed: boolean; metadata: RepositoryMetadata }>;

export type ImmediateReader = (
  repository: RepositoryRef,
) => Promise<RepositoryMetadata>;

export type PullReader = (
  review: ReviewRef,
  fallback: RepositoryMetadata,
) => Promise<RepositoryMetadata>;

export const fixture = fixtureHtml;
export const emptyMetadata = { attributes: '', codeowners: '' };
const changesPath = '/octo/repo/pull/1/changes';
export const pullReview = {
  key: 'octo/repo#1',
  owner: 'octo',
  pull: 1,
  repo: 'repo',
};
const collapseFileLabel = 'Collapse file';
const expandFileLabel = 'Expand file';
const labelAttribute = 'aria-label';
const reconciledEvent = 'diffseek-reconciled';
const filterMenuMarkup =
  '<ul role="menu" aria-label="Filter options"><li role="menuitem">Native</li></ul>';
const calls = new EventTarget();
const untilGuardMs = 4_000;

export const inertMetadata = {
  readImmediate: (): Promise<typeof emptyMetadata> => Promise.resolve(emptyMetadata),
  readPull: (
    _review: unknown,
    fallback: typeof emptyMetadata,
  ): Promise<typeof emptyMetadata> => Promise.resolve(fallback),
  refreshDefault: (): Promise<{
    changed: boolean;
    metadata: typeof emptyMetadata;
  }> => Promise.resolve({ changed: false, metadata: emptyMetadata }),
};

interface UntilAttempt {
  failure: () => unknown;
  passes: () => Promise<boolean>;
}

interface UntilFlags {
  done: boolean;
  rerun: boolean;
  running: boolean;
}

type UntilGate = ReturnType<typeof Promise.withResolvers<undefined>>;

export function appendMarkup(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  for (const node of parsed.body.childNodes) {
    document.body.append(document.importNode(node, true));
  }
}

export function installNativeBehavior(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    `button[${CSS.escape(labelAttribute)}="${CSS.escape(collapseFileLabel)}"], button[${CSS.escape(labelAttribute)}="${CSS.escape(expandFileLabel)}"]`,
  )) {
    button.addEventListener('click', (): void => {
      const label = button.getAttribute(labelAttribute);
      button.setAttribute(
        labelAttribute,
        label === collapseFileLabel ? expandFileLabel : collapseFileLabel,
      );
    });
  }
}

export async function installReviewPage(markup: string = fixture): Promise<void> {
  fakeBrowser.reset();
  await fakeBrowser.storage.local.set({
    'diffseek:filter-defaults': { hidden: [], viewed: [] },
  });
  replaceBody(markup);
  installNativeBehavior();
}

export function marked(completed: string[]): ReturnType<typeof vi.fn<typeof markViewed>> {
  return vi.fn<typeof markViewed>(() => Promise.resolve({
    completed,
    failed: [],
    requested: completed.length,
  }));
}

export function metadataSource(attributes: string): {
  readImmediate: () => Promise<typeof emptyMetadata>;
  refreshDefault: () => Promise<{ changed: boolean; metadata: typeof emptyMetadata }>;
} {
  const metadata = { ...emptyMetadata, attributes };
  return {
    readImmediate: (): Promise<typeof emptyMetadata> => Promise.resolve(metadata),
    refreshDefault: (): Promise<{ changed: boolean; metadata: typeof emptyMetadata }> =>
      Promise.resolve({ changed: false, metadata }),
  };
}

export async function nextReconcile(action: () => void): Promise<void> {
  const ready = Promise.withResolvers<undefined>();
  document.addEventListener(reconciledEvent, (): void => {
    ready.resolve(undefined);
  }, { once: true });
  action();
  await ready.promise;
}

export function openMenu(): void {
  appendMarkup(filterMenuMarkup);
}

export function replaceBody(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  document.body.replaceChildren(
    ...[...parsed.body.childNodes].map((node) => document.importNode(node, true)),
  );
}

export function reviewApp(
  extra: Partial<Parameters<typeof startReviewApp>[0]> = {},
  pathname: () => string = (): string => changesPath,
): Promise<ReviewApp> {
  return startReviewApp({
    ...inertMetadata,
    pathname,
    root: document,
    ...extra,
  });
}

/** Wraps an injected dependency so each call is an event `until` re-checks on. */
export function signalled<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args): Result => {
    const result = fn(...args);
    calls.dispatchEvent(new Event('call'));
    return result;
  };
}

/**
 * Resolves once `check` stops throwing. Re-checks on DOM mutations, session
 * reconciles, injected-dependency calls, and extension storage changes.
 * The timeout only fails a wait whose event never comes.
 */
export async function until(
  check: () => unknown,
  guardMs = untilGuardMs,
): Promise<void> {
  const attempt = rememberAttempt(check);
  if (await attempt.passes()) return;
  const gate = Promise.withResolvers<undefined>();
  const flags = { done: false, rerun: false, running: false };
  scheduleUntil(flags, gate, attempt, guardMs)();
  await gate.promise;
}

function continueUntil(flags: UntilFlags): boolean {
  return flags.rerun && !flags.done;
}

function listenUntil(recheck: () => void): MutationObserver {
  const observer = new MutationObserver(recheck);
  observer.observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  document.addEventListener(reconciledEvent, recheck);
  fakeBrowser.storage.onChanged.addListener(recheck);
  calls.addEventListener('call', recheck);
  return observer;
}

function rememberAttempt(check: () => unknown): UntilAttempt {
  let lastError: unknown;
  return {
    failure: (): unknown => lastError,
    passes: async (): Promise<boolean> => {
      try {
        await check();
        return true;
      } catch (error) {
        lastError = error;
        return false;
      }
    },
  };
}

function scheduleUntil(
  flags: UntilFlags,
  gate: UntilGate,
  attempt: UntilAttempt,
  guardMs: number,
): () => void {
  const observer = listenUntil(recheck);
  const timer = setTimeout((): void => {
    finish();
    gate.reject(untilFailure(attempt.failure()));
  }, guardMs);

  function finish(): void {
    stopUntil(flags, observer, recheck, timer);
  }

  function recheck(): void {
    if (flags.done || flags.running) {
      flags.rerun = !flags.done;
      return;
    }
    flags.running = true;
    void recheckPass();
  }

  async function recheckPass(): Promise<void> {
    do {
      flags.rerun = false;
      if (await attempt.passes()) {
        finish();
        gate.resolve(undefined);
        break;
      }
    } while (continueUntil(flags));
    flags.running = false;
  }

  return recheck;
}

function stopUntil(
  flags: UntilFlags,
  observer: MutationObserver,
  recheck: () => void,
  timer: ReturnType<typeof setTimeout>,
): void {
  flags.done = true;
  observer.disconnect();
  document.removeEventListener(reconciledEvent, recheck);
  fakeBrowser.storage.onChanged.removeListener(recheck);
  calls.removeEventListener('call', recheck);
  clearTimeout(timer);
}

function untilFailure(lastError: unknown): Error {
  if (lastError instanceof Error) return lastError;
  return new Error('until: condition never held');
}
