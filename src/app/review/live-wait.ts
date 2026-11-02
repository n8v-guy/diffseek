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
    const unviewedFileRow = (): boolean =>
      [...document.querySelectorAll('[role="treeitem"]:not([aria-expanded])')].some((row) =>
        [...row.querySelectorAll('[data-diffseek-viewed-action][aria-pressed="false"]')].some(
          (action) => action.closest('[role="treeitem"]') === row,
        ),
      );
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
        case 'text': {
          const text = document.querySelector(condition.selector)?.textContent.trim();
          return mark(text != null && new RegExp(condition.pattern).test(text));
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
        case 'link-prefix':
          return mark(
            [...document.querySelectorAll('a')].some(
              (link) => link.textContent.trim().startsWith(condition.prefix) && visible(link),
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
        case 'trace-settled': {
          const data = document.documentElement.dataset;
          return mark(data.diffseekTreeOpen === '0' && data.diffseekPanelOpen === '0');
        }
      }
    };
    const observed = (value: string): boolean => value !== '';
    const observe = (test: () => string) =>
      new Promise<unknown>((resolve) => {
        const first = test();
        if (observed(first)) {
          resolve(first);
          return;
        }
        const observer = new MutationObserver(() => {
          const result = test();
          if (!observed(result)) return;
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
}

export async function untilDom(
  page: Page,
  condition: DomCondition,
  guardMs: number,
  message: string,
): Promise<unknown> {
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
