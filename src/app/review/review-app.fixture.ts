import type { markViewed } from '@diffseek/github/review-page/viewed-actions';
import type { ReviewRef } from '@diffseek/github/routing/page-route';
import type {
  RepositoryMetadata,
  RepositoryRef,
} from '@diffseek/repository-metadata';

import fixtureHtml from '@diffseek/github/review-page/fixtures/github-pr.html?raw';
import { expect, vi } from 'vitest';
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
const filterDefaultsKey = 'diffseek:filter-defaults';
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

/** A `markFiles` stand-in that flips the native viewed controls as GitHub would. */
export const markNatively: typeof markViewed = (snapshot, paths, { viewed }) => {
  for (const path of paths) setViewed(snapshot.viewedControl(path), viewed);
  return Promise.resolve({ completed: paths, failed: [], requested: paths.length });
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

export function alwaysRead(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-diffseek-always-read]');
}

export function appendMarkup(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  for (const node of parsed.body.childNodes) {
    document.body.append(document.importNode(node, true));
  }
}

export function checked(kind: string, value = 'true'): null | string {
  return facetButton(kind, value)?.getAttribute('aria-checked') ?? null;
}

export function clickFacet(kind: string, value = 'true'): void {
  facetButton(kind, value)?.click();
}

export function facetButton(kind: string, value = 'true'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(facetSelector(kind, value));
}

export function facetCount(kind: string, value = 'true'): null | string {
  return document.querySelector(
    `.diffseek-menu-row:has(${facetSelector(kind, value)}) .diffseek-menu-count`,
  )?.textContent ?? null;
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
  await saveFilterDefaults({ hidden: [], viewed: [] });
  replaceBody(markup);
  installNativeBehavior();
}

export function isHidden(id: string): 'until-found' | boolean | undefined {
  return document.getElementById(id)?.hidden;
}

export function lastSnackbar(): string | undefined {
  return [...document.querySelectorAll('[data-diffseek="snackbar"]')].at(-1)?.textContent;
}

/** The arguments of a `markFiles` call that marks `paths` viewed. */
export function markCall(paths: string[]): unknown[] {
  return [expect.anything(), paths, expect.objectContaining({ viewed: true })];
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

export function saveFilterDefaults(
  defaults: { hidden: string[]; viewed?: string[] },
): Promise<void> {
  return fakeBrowser.storage.local.set({ [filterDefaultsKey]: defaults });
}

export function setViewed(control: Element | null | undefined, viewed: boolean): void {
  control?.setAttribute(labelAttribute, viewed ? 'Viewed' : 'Not Viewed');
  control?.setAttribute('aria-pressed', String(viewed));
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

export async function storedFilterDefaults(): Promise<unknown> {
  return (await fakeBrowser.storage.local.get(filterDefaultsKey))[filterDefaultsKey];
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
  await scheduleUntil(attempt, guardMs);
}

export function viewedAction(path: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#${CSS.escape(path)} [data-diffseek-viewed-action]`,
  );
}

function continueUntil(flags: UntilFlags): boolean {
  return flags.rerun && !flags.done;
}

function facetSelector(kind: string, value: string): string {
  return `[data-filter-kind="${CSS.escape(kind)}"][data-filter-value="${CSS.escape(value)}"]`;
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

function scheduleUntil(attempt: UntilAttempt, guardMs: number): Promise<undefined> {
  const gate = Promise.withResolvers<undefined>();
  const flags = { done: false, rerun: false, running: false };
  const observer = listenUntil(recheck);
  const timer = setTimeout((): void => {
    finish();
    gate.reject(untilFailure(attempt.failure()));
  }, guardMs);

  function finish(): void {
    flags.done = true;
    observer.disconnect();
    document.removeEventListener(reconciledEvent, recheck);
    fakeBrowser.storage.onChanged.removeListener(recheck);
    calls.removeEventListener('call', recheck);
    clearTimeout(timer);
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

  recheck();
  return gate.promise;
}

function untilFailure(lastError: unknown): Error {
  if (lastError instanceof Error) return lastError;
  return new Error('until: condition never held');
}
