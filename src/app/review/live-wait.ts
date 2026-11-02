import type { BrowserContext, ElementHandle, Page } from '@playwright/test';

import '@diffseek/browser/page-globals';

/**
 * Event-based waits for the live e2e. Each wait is a MutationObserver in the
 * page that resolves the moment its condition holds, so measurements are not
 * quantized by Playwright's retry intervals. The Node-side timeout is only a
 * failure guard, never pacing.
 *
 * Each helper is its own init script. Playwright serializes only the function
 * passed to addInitScript, so the page copies talk through globalThis.
 */
export type DomCondition =
  | { key: string; kind: 'dataset-above'; value: number }
  | { kind: 'absent'; selector: string }
  | { kind: 'attr'; name: string; selector: string; value: string }
  | { kind: 'filter-button-ready' }
  | { kind: 'filter-menu-or-replaced' }
  | { kind: 'link-prefix'; prefix: string }
  | { kind: 'present'; selector: string }
  | { kind: 'text'; pattern: string; selector: string; }
  | { kind: 'trace-settled' }
  | { kind: 'unviewed-file-row' };

interface AttributeExpectation {
  name: string;
  value: string;
}

interface LiveGuard {
  message: string;
  ms: number;
}

/** Installs the in-page observer helpers into every document of the context. */
export async function installLiveWaits(context: BrowserContext): Promise<void> {
  await context.addInitScript(installLiveHolds);
  await context.addInitScript(installLiveVisible);
  await context.addInitScript(installLiveFilterButton);
  await context.addInitScript(installLiveInteractive);
  await context.addInitScript(installLiveCheckDom);
  await context.addInitScript(installLiveMenuState);
  await context.addInitScript(installLiveLinkPrefix);
  await context.addInitScript(installLiveTextMatches);
  await context.addInitScript(installLiveUnviewedRow);
  await context.addInitScript(installLiveCheckReview);
  await context.addInitScript(installLiveCheck);
  await context.addInitScript(installLiveObserve);
  await context.addInitScript(installLiveWaitEntry);
}

export async function tagFilterButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.__liveTagFilterButton();
  });
}

export async function untilAttribute(
  element: ElementHandle<Element>,
  attribute: AttributeExpectation,
  guard: LiveGuard,
): Promise<unknown> {
  return guardWait(
    element.evaluate((node, expected) => {
      return globalThis.__liveWaitElement(node, expected.name, expected.value);
    }, attribute),
    guard,
  );
}

export async function untilDom(
  page: Page,
  condition: DomCondition,
  guard: LiveGuard,
): Promise<unknown> {
  return guardWait(
    page.evaluate((value) => {
      return globalThis.__liveWait(value);
    }, condition),
    guard,
    `${guard.message} (${JSON.stringify(condition)})`,
  );
}

/** Failure guard only: rejects if the event never comes. */
async function guardWait<T>(
  work: Promise<T>,
  guard: LiveGuard,
  message = guard.message,
): Promise<T> {
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    reject(new Error(`${message}: not seen within ${guard.ms} ms`));
  }, guard.ms);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function installLiveCheck(): void {
  Object.defineProperty(globalThis, '__liveCheck', {
    configurable: true,
    value(condition: DomCondition): unknown {
      const dom = globalThis.__liveCheckDom(condition);
      if (dom !== undefined) return dom;
      return globalThis.__liveCheckReview(condition);
    },
    writable: true,
  });
}

function installLiveCheckDom(): void {
  Object.defineProperty(globalThis, '__liveCheckDom', {
    configurable: true,
    value(condition: DomCondition): unknown {
      const root = globalThis.document;
      if (condition.kind === 'absent') {
        return root.querySelector(condition.selector) === null;
      }
      if (condition.kind === 'attr') {
        return (
          root.querySelector(condition.selector)?.getAttribute(condition.name) ===
          condition.value
        );
      }
      if (condition.kind === 'dataset-above') {
        const raw = root.documentElement.dataset[condition.key] ?? '0';
        return Number(raw) > condition.value;
      }
      if (condition.kind === 'present') {
        return globalThis.__liveVisible(root.querySelector(condition.selector));
      }
      if (condition.kind === 'trace-settled') {
        const data = root.documentElement.dataset;
        return (
          data['diffseekTreeOpen'] === '0' && data['diffseekPanelOpen'] === '0'
        );
      }
      return undefined;
    },
    writable: true,
  });
}

function installLiveCheckReview(): void {
  Object.defineProperty(globalThis, '__liveCheckReview', {
    configurable: true,
    value(condition: DomCondition): unknown {
      if (condition.kind === 'filter-button-ready') {
        const button = globalThis.__liveFilterButton();
        return button !== null && globalThis.__liveInteractive(button);
      }
      if (condition.kind === 'filter-menu-or-replaced') {
        return globalThis.__liveMenuState();
      }
      if (condition.kind === 'link-prefix') {
        return globalThis.__liveLinkPrefix(condition.prefix);
      }
      if (condition.kind === 'text') {
        return globalThis.__liveTextMatches(condition.selector, condition.pattern);
      }
      if (condition.kind === 'unviewed-file-row') return globalThis.__liveUnviewedRow();
      return false;
    },
    writable: true,
  });
}

function installLiveFilterButton(): void {
  Object.defineProperty(globalThis, '__liveFilterButton', {
    configurable: true,
    value(): HTMLButtonElement | null {
      for (const button of globalThis.document.querySelectorAll('button')) {
        if (buttonLabel(button) === 'Filter options') return button;
      }
      return null;
    },
    writable: true,
  });

  function buttonLabel(button: HTMLButtonElement): string {
    const labelledBy = button.getAttribute('aria-labelledby');
    const label = button.getAttribute('aria-label');
    if (label !== null) return label;
    if (labelledBy === null) return '';
    return labelledBy
      .split(/\s+/v)
      .map((id) => globalThis.document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
}

function installLiveHolds(): void {
  Object.defineProperty(globalThis, '__liveHolds', {
    configurable: true,
    value(result: unknown): boolean {
      const blocked: readonly unknown[] = [false, null, undefined, '', 0];
      return !blocked.includes(result);
    },
    writable: true,
  });
}

function installLiveInteractive(): void {
  Object.defineProperty(globalThis, '__liveInteractive', {
    configurable: true,
    value(button: HTMLButtonElement): boolean {
      const style = button.getAttribute('style') ?? '';
      if (style.includes('anchor-name')) return true;
      const key = Object.keys(button).find((name) => name.startsWith('__reactProps$'));
      if (key === undefined || !Object.hasOwn(button, key)) return false;
      const props = Reflect.get(button, key) as unknown;
      return (
        typeof props === 'object' &&
        props !== null &&
        'onClick' in props &&
        typeof props.onClick === 'function'
      );
    },
    writable: true,
  });
}

function installLiveLinkPrefix(): void {
  Object.defineProperty(globalThis, '__liveLinkPrefix', {
    configurable: true,
    value(prefix: string): boolean {
      return [...globalThis.document.querySelectorAll('a')].some((link) => {
        const text = link.textContent.trim();
        return text.startsWith(prefix) && globalThis.__liveVisible(link);
      });
    },
    writable: true,
  });
}

function installLiveMenuState(): void {
  Object.defineProperty(globalThis, '__liveMenuState', {
    configurable: true,
    value(): '' | 'open' | 'replaced' {
      if (globalThis.document.querySelector('[data-diffseek="filters"]')) {
        return 'open';
      }
      const button = globalThis.__liveFilterButton();
      if (button !== null && !Object.hasOwn(button.dataset, 'liveClicked')) {
        return 'replaced';
      }
      return '';
    },
    writable: true,
  });
}

function installLiveObserve(): void {
  Object.defineProperty(globalThis, '__liveObserve', {
    configurable: true,
    value(test: () => unknown): Promise<unknown> {
      return new Promise((resolve) => {
        const first = test();
        if (globalThis.__liveHolds(first)) {
          resolve(first);
          return;
        }
        const observer = new MutationObserver(() => {
          const result = test();
          if (!globalThis.__liveHolds(result)) return;
          observer.disconnect();
          resolve(result);
        });
        observer.observe(globalThis.document, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
      });
    },
    writable: true,
  });
}

function installLiveTextMatches(): void {
  Object.defineProperty(globalThis, '__liveTextMatches', {
    configurable: true,
    value(selector: string, pattern: string): boolean {
      const text = globalThis.document.querySelector(selector)?.textContent.trim();
      return text !== undefined && new RegExp(pattern).test(text);
    },
    writable: true,
  });
}

function installLiveUnviewedRow(): void {
  Object.defineProperty(globalThis, '__liveUnviewedRow', {
    configurable: true,
    value(): boolean {
      const rows = globalThis.document.querySelectorAll(
        '[role="treeitem"]:not([aria-expanded])',
      );
      return [...rows].some((row) =>
        [...row.querySelectorAll('[data-diffseek-viewed-action][aria-pressed="false"]')].some(
          (action) => action.closest('[role="treeitem"]') === row,
        ),
      );
    },
    writable: true,
  });
}

function installLiveVisible(): void {
  Object.defineProperty(globalThis, '__liveVisible', {
    configurable: true,
    value(element: Element | null): boolean {
      return (
        element !== null &&
        (typeof element.checkVisibility !== 'function' || element.checkVisibility())
      );
    },
    writable: true,
  });
}

function installLiveWaitEntry(): void {
  const define = {
    configurable: true,
    writable: true,
  };
  Object.defineProperties(globalThis, {
    __liveTagFilterButton: {
      ...define,
      value(): void {
        globalThis.__liveFilterButton()?.setAttribute('data-live-clicked', '');
      },
    },
    __liveWait: {
      ...define,
      value(condition: unknown): Promise<unknown> {
        return globalThis.__liveObserve(() => globalThis.__liveCheck(condition));
      },
    },
    __liveWaitElement: {
      ...define,
      value(element: Element, name: string, expected: string): Promise<unknown> {
        return globalThis.__liveObserve(
          () => element.getAttribute(name) === expected,
        );
      },
    },
  });
}
