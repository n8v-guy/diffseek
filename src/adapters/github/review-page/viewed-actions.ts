import { ReviewIndex } from '@diffseek/review';

import {
  type PageSnapshot,
  viewedControlState,
} from './page-adapter';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export type ActionResult = {
  requested: number;
  completed: string[];
  failed: Array<{ path: string; reason: string }>;
};

export async function markViewed(
  snapshot: SupportedSnapshot,
  paths: string[],
  viewed: boolean,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (completed: number, requested: number) => void;
  } = {},
): Promise<ActionResult> {
  const result: ActionResult = {
    requested: paths.length,
    completed: [],
    failed: [],
  };

  for (const path of paths) {
    if (options.signal?.aborted) break;
    const resolveButton = () => viewedButtonFor(snapshot, path);
    const button = resolveButton();
    if (!button) {
      result.failed.push({ path, reason: 'Viewed control is unavailable' });
      options.onProgress?.(
        result.completed.length + result.failed.length,
        result.requested,
      );
      continue;
    }
    if (isViewed(button) === viewed) {
      result.completed.push(path);
      options.onProgress?.(result.completed.length, result.requested);
      continue;
    }

    const confirmed = waitForViewedState(
      resolveButton,
      button,
      viewed,
      options.timeoutMs ?? 1_500,
      options.signal,
    );
    button.click();
    if (await confirmed) {
      const file = snapshot.files.find((candidate) => candidate.path === path);
      if (file) file.viewed = viewed;
      result.completed.push(path);
    } else {
      result.failed.push({
        path,
        reason: 'GitHub did not confirm viewed state',
      });
    }
    options.onProgress?.(
      result.completed.length + result.failed.length,
      result.requested,
    );
  }

  return result;
}

export function mountViewedActions(
  snapshot: SupportedSnapshot,
  onAction: (viewed: boolean, paths: string[]) => void,
  index = new ReviewIndex(snapshot.files),
): void {
  const tree = snapshot.tree();
  if (!tree) return;
  const staleActions = new Set(
    tree.querySelectorAll<HTMLButtonElement>('[data-diffseek-viewed-action]'),
  );
  const staleAnchors = new Set(
    tree.querySelectorAll<HTMLElement>('.diffseek-viewed-icon-anchor'),
  );
  const filesByPath = new Map(
    snapshot.files.map((file) => [file.path, file]),
  );

  for (const item of tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')) {
    const paths = index
      .filesUnder(item.id)
      .filter((file) => file.capabilities.viewed)
      .map((file) => file.path);
    if (paths.length === 0) continue;

    const viewed = paths.every((path) => filesByPath.get(path)?.viewed);
    const icon = [...item.querySelectorAll<SVGElement>('svg.octicon')].find(
      (candidate) =>
        candidate.closest('[role="treeitem"]') === item &&
        [...candidate.classList].some((name) =>
          name.startsWith('octicon-file'),
        ),
    );
    if (!icon) continue;
    const action =
      [...item.querySelectorAll<HTMLButtonElement>(
        '[data-diffseek-viewed-action]',
      )].find((candidate) => candidate.closest('[role="treeitem"]') === item) ??
      document.createElement('button');
    action.type = 'button';
    action.dataset.diffseekViewedAction = 'true';
    action.className = 'diffseek-viewed-action';
    const label = viewed ? 'Mark as not viewed' : 'Mark as viewed';
    if (action.getAttribute('aria-label') !== label) {
      action.setAttribute('aria-label', label);
    }
    if (action.getAttribute('aria-pressed') !== String(viewed)) {
      action.setAttribute('aria-pressed', String(viewed));
    }
    action.title = label;
    action.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onAction(!viewed, paths);
    };
    staleActions.delete(action);
    if (icon.parentElement) {
      staleAnchors.delete(icon.parentElement);
      icon.parentElement.classList.add('diffseek-viewed-icon-anchor');
    }
    if (icon.previousElementSibling !== action) {
      icon.before(action);
    }
  }

  for (const action of staleActions) action.remove();
  for (const anchor of staleAnchors) {
    anchor.classList.remove('diffseek-viewed-icon-anchor');
  }
}

function isViewed(button: HTMLButtonElement): boolean {
  return viewedControlState(button) === true;
}

function viewedButtonFor(
  snapshot: SupportedSnapshot,
  path: string,
): HTMLButtonElement | null {
  return snapshot.viewedControl(path);
}

function observationRoot(button: HTMLButtonElement): Element {
  return (
    button.closest('[role="region"]') ??
    button.closest('[data-diff-header-wrapper="true"]') ??
    button
  );
}

function waitForViewedState(
  resolveButton: () => HTMLButtonElement | null,
  button: HTMLButtonElement,
  viewed: boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve(confirmed);
    };
    const check = () => {
      const current = resolveButton();
      if (current && isViewed(current) === viewed) finish(true);
    };
    const observer = new MutationObserver(check);
    observer.observe(observationRoot(button), {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['aria-label', 'aria-pressed'],
    });
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    queueMicrotask(check);
  });
}
