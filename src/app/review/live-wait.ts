import type { BrowserContext, ElementHandle, Page } from '@playwright/test';

/**
 * Event-based waits for the live e2e. Each wait is a MutationObserver in the
 * page that resolves the moment its condition holds, so measurements are not
 * quantized by Playwright's retry intervals. The Node-side timeout is only a
 * failure guard, never pacing.
 */
export type DomCondition =
  | { kind: 'present'; selector: string }
  | { kind: 'absent'; selector: string }
  | { kind: 'text'; selector: string; pattern: string }
  | { kind: 'attr'; selector: string; name: string; value: string }
  | { kind: 'dataset-above'; key: string; value: number }
  | { kind: 'link-prefix'; prefix: string }
  | { kind: 'unviewed-file-row' }
  | { kind: 'filter-button-ready' }
  | { kind: 'filter-menu-or-replaced' }
  | { kind: 'trace-settled' };

declare global {
  interface Window {
    __liveWait?: (condition: DomCondition) => Promise<unknown>;
    __liveWaitElement?: (element: Element, name: string, value: string) => Promise<unknown>;
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
    const check = (condition: DomCondition): unknown => {
      switch (condition.kind) {
        case 'present':
          return visible(document.querySelector(condition.selector));
        case 'absent':
          return document.querySelector(condition.selector) == null;
        case 'text': {
          const text = document.querySelector(condition.selector)?.textContent?.trim();
          return text != null && new RegExp(condition.pattern).test(text);
        }
        case 'attr':
          return (
            document.querySelector(condition.selector)?.getAttribute(condition.name) ===
            condition.value
          );
        case 'dataset-above':
          return Number(document.documentElement.dataset[condition.key] ?? '0') > condition.value;
        case 'link-prefix':
          return [...document.querySelectorAll('a')].some(
            (link) => link.textContent?.trim().startsWith(condition.prefix) && visible(link),
          );
        case 'unviewed-file-row':
          return [...document.querySelectorAll('[role="treeitem"]:not([aria-expanded])')].some(
            (row) =>
              [...row.querySelectorAll('[data-diffseek-viewed-action][aria-pressed="false"]')].some(
                (action) => action.closest('[role="treeitem"]') === row,
              ),
          );
        case 'filter-button-ready': {
          const button = filterButton();
          return button != null && interactive(button);
        }
        case 'filter-menu-or-replaced': {
          if (document.querySelector('[data-diffseek="filters"]')) return 'open';
          const button = filterButton();
          return button && !button.hasAttribute('data-live-clicked') ? 'replaced' : false;
        }
        case 'trace-settled': {
          const data = document.documentElement.dataset;
          return data.diffseekTreeOpen === '0' && data.diffseekPanelOpen === '0';
        }
      }
    };
    const observe = (test: () => unknown) =>
      new Promise<unknown>((resolve) => {
        const first = test();
        if (first) {
          resolve(first);
          return;
        }
        const observer = new MutationObserver(() => {
          const result = test();
          if (!result) return;
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
      observe(() => element.getAttribute(name) === value);
    // Tag the current filter button so a client re-render (a new node) is observable.
    (window as unknown as { __liveTagFilterButton: () => void }).__liveTagFilterButton = () => {
      filterButton()?.setAttribute('data-live-clicked', '');
    };
  });
}

export async function untilDom(
  page: Page,
  condition: DomCondition,
  guardMs: number,
  message: string,
): Promise<unknown> {
  return guard(
    page.evaluate((value) => window.__liveWait!(value), condition),
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
      (node, [attribute, expected]) => window.__liveWaitElement!(node, attribute!, expected!),
      [name, value],
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
