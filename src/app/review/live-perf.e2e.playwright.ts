import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  assertWithinBudgets,
  defaultLivePerfBudgets,
  defaultLivePrUrl,
  expectedGeneratedTotal,
  generatedIndexedText,
  isExtensionMetadataRequest,
  isInlineStorageState,
  parseInlineStorageState,
  parseStorageCookies,
  type LivePerfMetrics,
  type LivePerfScenario,
} from './live-perf.helpers';

const liveEnabled = process.env.DIFFSEEK_LIVE_E2E === '1';
const livePrUrl = process.env.DIFFSEEK_LIVE_PR_URL ?? defaultLivePrUrl;
const storageStateSource = process.env.DIFFSEEK_GITHUB_STORAGE_STATE;
const budgets = defaultLivePerfBudgets();
const generatedCounter =
  '[data-diffseek-menu-count-action][data-viewed-facet="generated"][data-viewed-value="true"]';
const generatedViewedAction =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"][data-viewed-value="true"]';
const viewedFacetAction =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="viewed"][data-viewed-value="true"]';

describeLive('live DiffSeek performance', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(900_000);

  let context: BrowserContext;
  let networkUrls: string[];
  let sharedPage: Page;

  test.beforeAll(async () => {
    if (!storageStateSource) {
      test.skip(
        true,
        'Set DIFFSEEK_GITHUB_STORAGE_STATE to Playwright storageState JSON (inline secret or file path). Logged-out GitHub stays on classic /files and loops with DiffSeek /changes redirect.',
      );
      return;
    }
    const extension = resolve('.output/chrome-mv3');
    const userDataDir = await mkdtemp(join(tmpdir(), 'diffseek-live-e2e-'));
    networkUrls = [];
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    let raw: unknown;
    try {
      raw = await loadStorageState(storageStateSource);
    } catch (error) {
      throw new Error(
        `Failed to load DIFFSEEK_GITHUB_STORAGE_STATE: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    await context.addCookies(parseStorageCookies(raw));
    context.on('request', (request) => {
      if (!request.serviceWorker()) return;
      const url = request.url();
      if (isExtensionMetadataRequest(url)) networkUrls.push(url);
    });
    await context.addInitScript(() => {
      document.addEventListener('diffseek-reconciled', () => {
        const root = document.documentElement;
        const current = Number(root.dataset.diffseekRedraws ?? '0');
        root.dataset.diffseekRedraws = String(current + 1);
      });
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('cold path: clean store indexes generated files', async () => {
    await clearExtensionStore(context);
    const setupPage = await context.newPage();
    await setupPage.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await assertAuthenticatedReview(setupPage);
    await clearViewedFiles(setupPage);
    await setupPage.close();

    await clearExtensionStore(context);
    networkUrls = [];
    sharedPage = await context.newPage();
    await sharedPage.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await markNavStart(sharedPage);
    await resetRedraws(sharedPage);
    await expect(sharedPage.getByLabel('Filter options')).toBeVisible({
      timeout: 120_000,
    });

    const menuOpenSeconds = await openFilterMenu(sharedPage);
    await expect(sharedPage.locator(generatedCounter)).toHaveText(
      generatedIndexedText(expectedGeneratedTotal),
      { timeout: 120_000 },
    );
    await settleRedraws(sharedPage);
    const metrics = collectMetrics(
      'cold',
      menuOpenSeconds,
      await secondsSinceNav(sharedPage),
      networkUrls,
      await readRedraws(sharedPage),
    );
    reportMetrics(metrics);
    expect(assertWithinBudgets(metrics, budgets)).toEqual([]);
    expect(metrics.networkRequests).toBeGreaterThan(0);
  });

  test('warm path: cached store reopens and reindexes', async () => {
    networkUrls = [];
    await sharedPage.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await markNavStart(sharedPage);
    await resetRedraws(sharedPage);
    await expect(sharedPage.getByLabel('Filter options')).toBeVisible({
      timeout: 120_000,
    });

    const menuOpenSeconds = await openFilterMenu(sharedPage);
    await expect(sharedPage.locator(generatedCounter)).toHaveText(
      generatedIndexedText(expectedGeneratedTotal),
      { timeout: 120_000 },
    );
    await settleRedraws(sharedPage);
    const metrics = collectMetrics(
      'warm',
      menuOpenSeconds,
      await secondsSinceNav(sharedPage),
      networkUrls,
      await readRedraws(sharedPage),
    );
    reportMetrics(metrics);
    expect(assertWithinBudgets(metrics, budgets)).toEqual([]);
  });

  test('marks all generated files viewed', async () => {
    networkUrls = [];
    await closeFilterMenu(sharedPage);
    await resetRedraws(sharedPage);
    const menuOpenSeconds = await openFilterMenu(sharedPage);
    await expect(sharedPage.locator(generatedCounter)).toHaveText(
      generatedIndexedText(expectedGeneratedTotal),
      { timeout: 120_000 },
    );

    const action = sharedPage.locator(generatedViewedAction);
    await expect(action).toHaveAttribute('aria-label', 'Mark as viewed');
    await markNavStart(sharedPage);
    await action.click();
    await expect(
      sharedPage.locator('[data-diffseek="snackbar"]').first(),
    ).toContainText(`Marked ${expectedGeneratedTotal} files as viewed`, {
      timeout: 180_000,
    });
    await expect(action).toHaveAttribute('aria-label', 'Mark as not viewed', {
      timeout: 60_000,
    });
    await settleRedraws(sharedPage);
    const metrics = collectMetrics(
      'mark-generated-viewed',
      menuOpenSeconds,
      await secondsSinceNav(sharedPage),
      networkUrls,
      await readRedraws(sharedPage),
    );
    reportMetrics(metrics);
    expect(assertWithinBudgets(metrics, budgets)).toEqual([]);
  });
});

function describeLive(title: string, body: () => void): void {
  if (liveEnabled) test.describe(title, body);
  else test.describe.skip(title, body);
}

async function loadStorageState(source: string): Promise<unknown> {
  if (isInlineStorageState(source)) return parseInlineStorageState(source);
  return JSON.parse(await readFile(source, 'utf8'));
}

function collectMetrics(
  scenario: LivePerfScenario,
  menuOpenSeconds: number,
  indexingSeconds: number,
  urls: string[],
  redraws: number,
): LivePerfMetrics {
  return {
    scenario,
    menuOpenSeconds,
    indexingSeconds,
    networkRequests: urls.length,
    networkUrls: [...urls],
    redraws,
  };
}

function reportMetrics(metrics: LivePerfMetrics): void {
  test.info().annotations.push({
    type: `live-perf:${metrics.scenario}`,
    description: JSON.stringify(metrics),
  });
  console.log(`diffseek live-perf:${metrics.scenario}`, metrics);
}

async function assertAuthenticatedReview(page: Page): Promise<void> {
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
    'GitHub session from DIFFSEEK_GITHUB_STORAGE_STATE is not authenticated',
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/changes(\?|$)/);
  await expect(page.locator('[data-diffseek-viewed-action]').first()).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByLabel('Filter options')).toBeVisible({
    timeout: 120_000,
  });
}

async function openFilterMenu(page: Page): Promise<number> {
  await page.evaluate(() => performance.mark('diffseek-menu-click'));
  const filters = page.locator('[data-diffseek="filters"]');
  const button = page.getByRole('button', { name: 'Filter options' });
  for (let attempt = 0; attempt < 8 && (await filters.count()) === 0; attempt += 1) {
    await dismissCompactLinePopover(page);
    await button.click({ delay: 80 }).catch(() => undefined);
  }
  await expect(filters).toHaveCount(1, { timeout: 60_000 });
  return page.evaluate(() => {
    performance.mark('diffseek-menu-ready');
    performance.measure(
      'diffseek-menu-open',
      'diffseek-menu-click',
      'diffseek-menu-ready',
    );
    const entry = performance.getEntriesByName('diffseek-menu-open').at(-1);
    return Number(((entry?.duration ?? 0) / 1000).toFixed(3));
  });
}

async function closeFilterMenu(page: Page): Promise<void> {
  if ((await page.locator('[data-diffseek="filters"]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(0);
}

async function dismissCompactLinePopover(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const popover of document.querySelectorAll(
      '[data-component="Popover"][data-open]',
    )) {
      if (popover.textContent?.includes('compact line height')) popover.remove();
    }
  });
}

async function markNavStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    performance.clearMarks('diffseek-nav-start');
    performance.mark('diffseek-nav-start');
  });
}

async function secondsSinceNav(page: Page): Promise<number> {
  return page.evaluate(() => {
    performance.mark('diffseek-nav-end');
    performance.measure(
      'diffseek-nav',
      'diffseek-nav-start',
      'diffseek-nav-end',
    );
    const entry = performance.getEntriesByName('diffseek-nav').at(-1);
    return Number(((entry?.duration ?? 0) / 1000).toFixed(3));
  });
}

async function resetRedraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.diffseekRedraws = '0';
  });
}

async function readRedraws(page: Page): Promise<number> {
  const value = Number(
    await page.locator('html').getAttribute('data-diffseek-redraws'),
  );
  return Number.isFinite(value) ? value : 0;
}

async function settleRedraws(page: Page, quietMs = 750): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await readRedraws(page);
        await page.evaluate(
          (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          quietMs,
        );
        return (await readRedraws(page)) === before;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function clearExtensionStore(browserContext: BrowserContext): Promise<void> {
  const worker =
    browserContext.serviceWorkers()[0] ??
    (await browserContext.waitForEvent('serviceworker', { timeout: 30_000 }));
  await worker.evaluate(() => {
    const extension = globalThis as unknown as {
      chrome: { storage: { local: { clear: () => Promise<void> } } };
    };
    return extension.chrome.storage.local.clear();
  });
}

async function clearViewedFiles(page: Page): Promise<void> {
  await openFilterMenu(page);
  const action = page.locator(viewedFacetAction);
  if ((await action.count()) === 0) return;
  const label = await action.getAttribute('aria-label', { timeout: 5_000 });
  if (label !== 'Mark as not viewed') return;
  await action.click();
  await expect(
    page.locator('[data-diffseek="snackbar"]').filter({
      hasText: /^Marked .+ as not viewed/,
    }),
  ).toBeVisible({ timeout: 300_000 });
}
