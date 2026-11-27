import type { BrowserContext, ElementHandle, Page } from '@playwright/test';

/** Page mutations and diff-panel or tree-row removals, counted the same with and without DiffSeek. */
export type GithubChurn = {
  mutations: number;
  panelsRemoved: number;
  panelsReadded: number;
  treeRowsRemoved: number;
  treeRowsReadded: number;
};

/**
 * Event-based waits for the live e2e. Each wait is a MutationObserver in the
 * page that resolves the moment its condition holds, so measurements are not
 * quantized by Playwright's retry intervals. The Node-side timeout is only a
 * failure guard, never pacing.
 */
export type DomCondition =
  | { kind: 'present'; selector: string }
  | { kind: 'absent'; selector: string }
  | { kind: 'count'; selector: string; count: number }
  | { kind: 'text'; selector: string; pattern: string }
  | { kind: 'attr'; selector: string; name: string; value: string }
  | { kind: 'dataset-above'; key: string; value: number }
  | { kind: 'link-text'; pattern: string }
  | { kind: 'unviewed-file-row' }
  | { kind: 'filter-button-ready' }
  | { kind: 'filter-menu-or-replaced' }
  | { kind: 'tree-hidden'; ids?: string[] }
  | { kind: 'trace-settled' };

declare global {
  interface Window {
    __liveWait?: (condition: DomCondition) => Promise<string>;
    __liveWaitElement?: (element: Element, name: string, value: string) => Promise<unknown>;
    __liveChurn?: GithubChurn;
    __liveChurnReset?: () => void;
  }
}

/** Installs the in-page observer helpers into every document of the context. */
export async function installLiveWaits(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const visible = (element: Element | null) =>
      element != null &&
      (typeof element.checkVisibility !== 'function' || element.checkVisibility());
    const filterButton = (): HTMLButtonElement | null => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
        const label =
          button.getAttribute('aria-label') ??
          button
            .getAttribute('aria-labelledby')
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim();
        if (label === 'Filter options') return button;
      }
      return null;
    };
    // GitHub server-renders this button, then replaces it with a client-
    // rendered one (the cold/warm redraw). Only the client copy has handlers:
    // it carries Primer's CSS anchor-name, and React props with onClick.
    const interactive = (button: HTMLButtonElement) => {
      if ((button.getAttribute('style') ?? '').includes('anchor-name')) return true;
      const key = Object.keys(button).find((name) => name.startsWith('__reactProps$'));
      const props = key ? (button as unknown as Record<string, { onClick?: unknown }>)[key] : null;
      return typeof props?.onClick === 'function';
    };
    const unviewedFileRow = (): boolean =>
      [...document.querySelectorAll('[role="treeitem"]:not([aria-expanded])')].some((row) =>
        [...row.querySelectorAll('[data-diffseek-viewed-action][aria-pressed="false"]')].some(
          (action) => action.closest('[role="treeitem"]') === row,
        ),
      );
    // Without `ids`, the hidden file rows must match the filters: each file has
    // one change status, so those rows' hidden counts add up. GitHub streams
    // panels in, and a file's row is hidden only once its panel is there.
    const treeHidden = (ids: string[] | undefined): boolean => {
      const rows = document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"]:not([aria-expanded])');
      const hidden = [...rows].filter((row) => row.dataset.diffseekFilteredOut === 'true').map((row) => row.id);
      if (ids) return hidden.join('\n') === ids.join('\n');
      const counts = [
        ...document.querySelectorAll('.diffseek-menu-row:has([data-filter-kind="statuses"]) .diffseek-menu-count'),
      ].map((count) => count.textContent.trim().split('/').map(Number));
      const filtered = counts.reduce((sum, [shown = 0, total = 0]) => sum + total - shown, 0);
      return counts.length > 0 && hidden.length === filtered;
    };
    const mark = (passed: boolean): '' | 'ready' => (passed ? 'ready' : '');
    const filterMenuState = (): 'open' | 'replaced' | '' => {
      if (document.querySelector('[data-diffseek="filters"]')) return 'open';
      const button = filterButton();
      if (button != null && !button.hasAttribute('data-live-clicked')) return 'replaced';
      return '';
    };
    const check = (condition: DomCondition): string => {
      switch (condition.kind) {
        case 'present':
          return mark(visible(document.querySelector(condition.selector)));
        case 'absent':
          return mark(document.querySelector(condition.selector) == null);
        case 'count':
          return mark(document.querySelectorAll(condition.selector).length >= condition.count);
        case 'text': {
          const text = document.querySelector(condition.selector)?.textContent.trim();
          return text != null && new RegExp(condition.pattern).test(text) ? text : '';
        }
        case 'attr':
          return mark(
            document.querySelector(condition.selector)?.getAttribute(condition.name) ===
              condition.value,
          );
        case 'dataset-above':
          return mark(
            Number(document.documentElement.dataset[condition.key] ?? '0') > condition.value,
          );
        case 'link-text':
          return mark(
            [...document.querySelectorAll('a')].some(
              (link) => new RegExp(condition.pattern).test(link.textContent.trim()) && visible(link),
            ),
          );
        case 'unviewed-file-row':
          return mark(unviewedFileRow());
        case 'filter-button-ready': {
          const button = filterButton();
          return mark(button != null && interactive(button));
        }
        case 'filter-menu-or-replaced':
          return filterMenuState();
        case 'tree-hidden':
          return mark(treeHidden(condition.ids));
        case 'trace-settled': {
          const data = document.documentElement.dataset;
          return mark(data.diffseekTreeOpen === '0' && data.diffseekPanelOpen === '0');
        }
      }
    };
    const observe = (test: () => string) =>
      new Promise<string>((resolve) => {
        const first = test();
        if (first !== '') {
          resolve(first);
          return;
        }
        const observer = new MutationObserver(() => {
          const result = test();
          if (result === '') return;
          observer.disconnect();
          resolve(result);
        });
        observer.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      });
    window.__liveWait = (condition) => observe(() => check(condition));
    window.__liveWaitElement = (element, name, value) =>
      observe(() => (element.getAttribute(name) === value ? 'ready' : ''));
    // Tag the current filter button so a client re-render (a new node) is observable.
    (window as unknown as { __liveTagFilterButton: () => void }).__liveTagFilterButton = () => {
      filterButton()?.setAttribute('data-live-clicked', '');
    };
  });
  await context.addInitScript(countChurn);
}

/**
 * In-page init script, so it must be self-contained. Counts page churn the
 * same with and without DiffSeek, off the DOM so reading it adds no mutation.
 */
function countChurn(): void {
  const churn = { mutations: 0, panelsRemoved: 0, panelsReadded: 0, treeRowsRemoved: 0, treeRowsReadded: 0 };
  const rows = [
    { kind: 'panels', selector: '[role="region"][id^="diff-"]', gone: new Set<string>() },
    { kind: 'treeRows', selector: '[role="treeitem"]', gone: new Set<string>() },
  ] as const;
  const rowIds = (records: MutationRecord[], nodes: 'addedNodes' | 'removedNodes', selector: string) =>
    new Set(
      records.flatMap((record) =>
        [...record[nodes]].flatMap((node) =>
          node instanceof Element
            ? [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)].map((row) => row.id)
            : [],
        ),
      ),
    );
  window.__liveChurn = churn;
  window.__liveChurnReset = () => {
    for (const key of Object.keys(churn) as (keyof GithubChurn)[]) churn[key] = 0;
    for (const { gone } of rows) gone.clear();
  };
  new MutationObserver((records) => {
    for (const record of records) {
      churn.mutations += record.type === 'childList' ? record.addedNodes.length + record.removedNodes.length : 1;
    }
    for (const { kind, selector, gone } of rows) {
      const removed = rowIds(records, 'removedNodes', selector);
      churn[`${kind}Removed`] += removed.size;
      for (const id of removed) gone.add(id);
      for (const id of rowIds(records, 'addedNodes', selector)) {
        if (gone.delete(id)) churn[`${kind}Readded`] += 1;
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

/** Restarts the page churn count; a new document starts at zero. */
export async function resetChurn(page: Page): Promise<void> {
  await page.evaluate(() => window.__liveChurnReset?.());
}

export async function readChurn(page: Page): Promise<GithubChurn> {
  return page.evaluate(() => {
    if (window.__liveChurn === undefined) throw new Error('live churn is not installed');
    return { ...window.__liveChurn };
  });
}

export async function untilDom(
  page: Page,
  condition: DomCondition,
  guardMs: number,
  message: string,
): Promise<string> {
  return guard(
    page.evaluate((value) => {
      const wait = window.__liveWait;
      if (wait === undefined) throw new Error('live wait is not installed');
      return wait(value);
    }, condition),
    guardMs,
    `${message} (${JSON.stringify(condition)})`,
  );
}

export async function untilAttribute(
  element: ElementHandle<Element>,
  name: string,
  value: string,
  guardMs: number,
  message: string,
): Promise<unknown> {
  return guard(
    element.evaluate(
      (node, pair) => {
        const wait = window.__liveWaitElement;
        if (wait === undefined) throw new Error('live wait is not installed');
        return wait(node, pair.attribute, pair.expected);
      },
      { attribute: name, expected: value },
    ),
    guardMs,
    message,
  );
}

export async function tagFilterButton(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __liveTagFilterButton: () => void }).__liveTagFilterButton(),
  );
}

/** Failure guard only: rejects if the event never comes. */
async function guard<T>(work: Promise<T>, guardMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message}: not seen within ${guardMs} ms`)), guardMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
