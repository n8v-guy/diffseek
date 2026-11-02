import type { BrowserContext, ElementHandle, Page } from '@playwright/test';

import '@diffseek/browser/page-globals';

/**
 * Event-based waits for the live e2e. Each wait is a MutationObserver in the
 * page that resolves the moment its condition holds, so measurements are not
 * quantized by Playwright's retry intervals. The Node-side timeout is only a
 * failure guard, never pacing.
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

const liveWaitPageSource = `
function liveHolds(result) {
  return result !== false && result !== null && result !== undefined && result !== '' && result !== 0;
}
function liveVisible(element) {
  return element !== null && (typeof element.checkVisibility !== 'function' || element.checkVisibility());
}
function liveFilterButton() {
  for (const button of globalThis.document.querySelectorAll('button')) {
    const labelledBy = button.getAttribute('aria-labelledby');
    const label = button.getAttribute('aria-label') ?? (labelledBy === null ? '' : labelledBy.split(/\\s+/v).map((id) => globalThis.document.getElementById(id)?.textContent ?? '').join(' ').trim());
    if (label === 'Filter options') return button;
  }
  return null;
}
function liveInteractive(button) {
  const style = button.getAttribute('style') ?? '';
  if (style.includes('anchor-name')) return true;
  const key = Object.keys(button).find((name) => name.startsWith('__reactProps$'));
  const props = key === undefined ? null : button[key];
  return typeof props?.onClick === 'function';
}
function liveCheck(condition) {
  const root = globalThis.document;
  switch (condition.kind) {
    case 'absent':
      return root.querySelector(condition.selector) === null;
    case 'attr':
      return root.querySelector(condition.selector)?.getAttribute(condition.name) === condition.value;
    case 'dataset-above':
      return Number(root.documentElement.dataset[condition.key] ?? '0') > condition.value;
    case 'filter-button-ready': {
      const button = liveFilterButton();
      return button !== null && liveInteractive(button);
    }
    case 'filter-menu-or-replaced': {
      if (root.querySelector('[data-diffseek="filters"]')) return 'open';
      const button = liveFilterButton();
      return button !== null && !Object.hasOwn(button.dataset, 'liveClicked') ? 'replaced' : false;
    }
    case 'link-prefix':
      return [...root.querySelectorAll('a')].some((link) => {
        const text = link.textContent;
        return text !== null && text.trim().startsWith(condition.prefix) && liveVisible(link);
      });
    case 'present':
      return liveVisible(root.querySelector(condition.selector));
    case 'text': {
      const text = root.querySelector(condition.selector)?.textContent?.trim();
      return text !== undefined && text !== null && new RegExp(condition.pattern).test(text);
    }
    case 'trace-settled': {
      const data = root.documentElement.dataset;
      return data.diffseekTreeOpen === '0' && data.diffseekPanelOpen === '0';
    }
    case 'unviewed-file-row':
      return [...root.querySelectorAll('[role="treeitem"]:not([aria-expanded])')].some((row) =>
        [...row.querySelectorAll('[data-diffseek-viewed-action][aria-pressed="false"]')].some(
          (action) => action.closest('[role="treeitem"]') === row,
        ),
      );
    default:
      return false;
  }
}
function liveObserve(test) {
  return new Promise((resolve) => {
    const first = test();
    if (liveHolds(first)) {
      resolve(first);
      return;
    }
    const observer = new globalThis.MutationObserver(() => {
      const result = test();
      if (!liveHolds(result)) return;
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
}
function installLiveWaitPage() {
  const define = (name, value) => {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  };
  define('__liveWait', (condition) => liveObserve(() => liveCheck(condition)));
  define('__liveWaitElement', (element, name, value) => liveObserve(() => element.getAttribute(name) === value));
  define('__liveTagFilterButton', () => {
    liveFilterButton()?.setAttribute('data-live-clicked', '');
  });
}
installLiveWaitPage();
`;

/** Installs the in-page observer helpers into every document of the context. */
export async function installLiveWaits(context: BrowserContext): Promise<void> {
  await context.addInitScript(liveWaitPageSource);
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
