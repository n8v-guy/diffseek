import type { ExtensionStorageLocal } from '@diffseek/browser/page-globals';

import {
  type BrowserContext,
  chromium,
  expect,
  type JSHandle,
  type Page,
  type Worker,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import '@diffseek/browser/page-globals';

const browserSession: {
  context?: BrowserContext;
  fixtureSource: string;
} = { fixtureSource: '' };
const fixturePath = path.resolve(
  'src/adapters/github/review-page/fixtures/github-pr.html',
);
export const markAll = 'Mark all viewed';
export const markRest = 'Mark the rest viewed';
export const attributesBody = [
  'src/** group=Code',
  'docs/** group=Docs',
  '*.ts linguist-language=TypeScript',
  'src/generated.ts linguist-generated',
].join('\n');
const filterDefaultsKey = 'diffseek:filter-defaults';
export const checkedAttribute = 'aria-checked';
export const labelAttribute = 'aria-label';
export const pressedAttribute = 'aria-pressed';
const textContentType = 'text/plain';
const viewedAppButton = '#diff-app button[aria-label="Viewed"]';
const viewedControlLabel = 'Viewed';
const gitObjectIdLength = 40;
const headOid = 'c'.repeat(gitObjectIdLength);
export const snackbarSelector = '[data-diffseek="snackbar"]';

type StorageLocal = ExtensionStorageLocal;

interface StoredDefaults {
  hidden: string[];
  viewed: string[];
}

export function browser(): BrowserContext {
  if (browserSession.context === undefined) {
    throw new Error('Extension browser was not started');
  }
  return browserSession.context;
}

export async function closeExtensionPages(): Promise<void> {
  await Promise.all(browser().pages().map((page) => page.close()));
}

export function expectMenuGeometry(
  buttonRect: null | { height: number; width: number; x: number; y: number },
  rootRect: null | { height: number; width: number; x: number; y: number },
  menuRect: null | { height: number; width: number; x: number; y: number },
): void {
  if (buttonRect === null || rootRect === null || menuRect === null) {
    throw new Error('Missing DiffSeek menu geometry');
  }
  expect({
    extendsRight: buttonRect.x + buttonRect.width > rootRect.x + rootRect.width,
    extendsTop: buttonRect.y < rootRect.y,
    insideMenuRight: buttonRect.x + buttonRect.width <= menuRect.x + menuRect.width,
    insideMenuTop: buttonRect.y >= menuRect.y,
  }).toEqual({
    extendsRight: true,
    extendsTop: true,
    insideMenuRight: true,
    insideMenuTop: true,
  });
}



export async function expectPressedViewed(page: Page): Promise<void> {
  await expect(
    page.locator(`#diff-app button[aria-label="${viewedControlLabel}"]`),
  ).toHaveAttribute(pressedAttribute, 'true');
  await expect(
    page.locator(`#diff-new button[aria-label="${viewedControlLabel}"]`),
  ).toHaveAttribute(pressedAttribute, 'true');
  await expect(
    page.locator(`#diff-generated button[aria-label="${viewedControlLabel}"]`),
  ).toHaveAttribute(pressedAttribute, 'true');
}

export function fixtureSource(): string {
  return browserSession.fixtureSource;
}

async function clearExtensionStorage(): Promise<void> {
  const local = await storageLocal();
  await local.evaluate((storage: StorageLocal): Promise<void> => storage.clear());
  await local.dispose();
}

async function extensionWorker(): Promise<Worker> {
  return (
    browser().serviceWorkers()[0] ??
    (await browser().waitForEvent('serviceworker'))
  );
}


const fixtureFolderItems = `
      <li id="src" role="treeitem" aria-label="src"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div><div>src</div></li>
      <li id="docs" role="treeitem" aria-label="docs"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div><div>docs</div></li>`;
const nativeFilterMenu = `<ul role="menu" aria-label="Filter options">
          <li role="none"><button type="button">Clear filters</button></li>
        </ul>`;
const fixturePageScript = String.raw`
    <script>
      // Every toast text ever shown: toasts are replaced or dismissed by
      // later events, so assertions read the history, not the screen.
      const toastLog = [];
      const host = globalThis;
      new host.MutationObserver(() => {
        for (const toast of globalThis.document.querySelectorAll('[data-diffseek="snackbar"]')) {
          if (toastLog.at(-1) === toast.textContent) continue;
          toastLog.push(toast.textContent);
          globalThis.document.documentElement.setAttribute('data-toast-log', toastLog.join('\n'));
        }
      }).observe(globalThis.document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      globalThis.document.documentElement.setAttribute('data-native-actions', 'idle');
      let pendingNativeActions = 0;
      let nativeJsChecked = true;
      const commitNativeAction = (action) => {
        pendingNativeActions += 1;
        globalThis.document.documentElement.setAttribute('data-native-actions', 'pending');
        setTimeout(() => {
          action();
          pendingNativeActions -= 1;
          if (pendingNativeActions === 0) {
            globalThis.document.documentElement.setAttribute('data-native-actions', 'idle');
          }
        }, Number(globalThis.document.documentElement.getAttribute('data-native-delay') ?? 10));
      };
      globalThis.document.addEventListener('click', (event) => {
        const clearNativeFilters = event.target.closest('button');
        if (clearNativeFilters?.textContent.trim() === 'Clear filters') {
          globalThis.document.documentElement.setAttribute('data-native-filter-cleared', 'true');
          clearNativeFilters.closest('[role="menu"]')?.remove();
          return;
        }
        const nativeFilter = event.target.closest(
          '[role="menuitemcheckbox"][aria-label=".js"]',
        );
        if (nativeFilter) {
          nativeJsChecked = !nativeJsChecked;
          nativeFilter.setAttribute(
            'aria-checked',
            String(nativeJsChecked),
          );
          nativeFilter.closest('[role="menu"]')?.remove();
          return;
        }
        const button = event.target.closest('button');
        if (!button) return;
        if (button.getAttribute('aria-label') === 'Filter options') {
          if (!globalThis.document.querySelector('[role="menu"]')) {
            globalThis.document.body.insertAdjacentHTML(
              'beforeend',
              '<ul role="menu" aria-label="Filter options">' +
                '<li role="menuitemcheckbox" aria-label=".js" aria-checked="' +
                nativeJsChecked +
                '">.js</li>' +
                '<li role="separator">Native separator</li>' +
                '</ul>',
            );
          }
        } else if (button.getAttribute('aria-label') === 'Collapse file') {
          commitNativeAction(() => button.setAttribute('aria-label', 'Expand file'));
        } else if (button.getAttribute('aria-label') === 'Expand file') {
          commitNativeAction(() => button.setAttribute('aria-label', 'Collapse file'));
        } else if (button.getAttribute('aria-label') === 'Not Viewed') {
          commitNativeAction(() => {
            button.setAttribute('aria-label', 'Viewed');
            button.setAttribute('aria-pressed', 'true');
          });
        } else if (button.getAttribute('aria-label') === 'Viewed') {
          commitNativeAction(() => {
            button.setAttribute('aria-label', 'Not Viewed');
            button.setAttribute('aria-pressed', 'false');
          });
        }
      });
    </script>`;

export function instrument(source: string, startsWithNativeFilter = false): string {
  const nativeMenu = startsWithNativeFilter ? nativeFilterMenu : '';
  return source
    .replace(
      '<ul role="tree" aria-label="File Tree">',
      () => `<ul role="tree" aria-label="File Tree">${fixtureFolderItems}`,
    )
    .replace(
      '</body>',
      () => `${nativeMenu}${fixturePageScript}</body>`,
    );
}

export async function markAllViewed(page: Page): Promise<void> {
  await page.locator('#diff-app button[aria-label="Not Viewed"]').click();
  await page.locator(`#src [aria-label="${markAll}"]`).click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'true');
  await page.locator(viewedAppButton).click();
  await expect(page.locator(`#src [aria-label="${markRest}"]`)).toBeVisible();
  await page.locator(`#src [aria-label="${markRest}"]`).click();
  await expect(
    page.locator(viewedAppButton),
  ).toHaveAttribute(pressedAttribute, 'true');
}

export async function openPull(pull: number, nativeFilter = false): Promise<Page> {
  const page = await browser().newPage();
  await page.route(
    `https://github.com/octo/repo/pull/${pull}/changes`,
    async (route) => {
      await route.fulfill({
        body: instrument(browserSession.fixtureSource, nativeFilter),
        contentType: 'text/html',
      });
    },
  );
  await page.goto(`https://github.com/octo/repo/pull/${pull}/changes`);
  return page;
}

export async function readStoredFilterDefaults(): Promise<unknown> {
  const local = await storageLocal();
  const stored = await local.evaluate(
    (storage: StorageLocal, key: string): Promise<unknown> => storage.get(key),
    filterDefaultsKey,
  );
  await local.dispose();
  return stored;
}

export async function resetExtensionStorage(): Promise<void> {
  await clearExtensionStorage();
  await writeFilterDefaults({ hidden: [], viewed: [] });
}

export async function startExtensionBrowser(): Promise<void> {
    browserSession.fixtureSource = await readFile(fixturePath, 'utf8');
    const extension = path.resolve('.output/chrome-mv3');
    browserSession.context = await chromium.launchPersistentContext('', {
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      channel: 'chromium',
      headless: true,
    });
    await browser().route(
      'https://github.com/octo/repo/pull/*/commits',
      async (route) => {
        await route.fulfill({
          body: `{"oid":"${headOid}"}`,
          contentType: 'text/html',
        });
      },
    );
    await browser().route('https://github.com/octo/repo/raw/**', async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (url.endsWith('/.gitattributes')) {
        await route.fulfill({
          body: attributesBody,
          contentType: textContentType,
        });
      } else if (url.endsWith('/CODEOWNERS') && !url.includes('/.github/')) {
        await route.fulfill({
          body: url.includes(`/raw/${headOid}/`)
            ? 'src/** @pull-source'
            : 'src/** @source',
          contentType: textContentType,
        });
      } else {
        await route.fulfill({ body: '', status: 404 });
      }
    });
}

export async function stopExtensionBrowser(): Promise<void> {
  await browser().close();
}

export async function writeFilterDefaults(
  defaults: null | StoredDefaults,
): Promise<void> {
  if (defaults === null) await removeExtensionStorage();
  else await setExtensionStorage(defaults);
}

async function removeExtensionStorage(): Promise<void> {
  const local = await storageLocal();
  await local.evaluate(
    (storage: StorageLocal, key: string): Promise<void> => storage.remove(key),
    filterDefaultsKey,
  );
  await local.dispose();
}

async function setExtensionStorage(value: StoredDefaults): Promise<void> {
  const local = await storageLocal();
  await local.evaluate(
    (storage: StorageLocal, items: Record<string, unknown>): Promise<void> => storage.set(items),
    { [filterDefaultsKey]: value },
  );
  await local.dispose();
}

async function storageLocal(): Promise<JSHandle<StorageLocal>> {
  const worker = await extensionWorker();
  return worker.evaluateHandle(
    (): StorageLocal => globalThis.chrome.storage.local,
  );
}
