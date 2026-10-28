import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  actionFailures,
  defaultLivePerfBudgets,
  defaultLivePrUrl,
  expectedGeneratedTotal,
  generatedCategorizedPattern,
  hotLossFailures,
  isInlineStorageState,
  livePerfSummary,
  liveSampleCount,
  medianBudgetFailures,
  medianSample,
  parseInlineStorageState,
  parseStorageCookies,
  rebuildFailures,
  type LivePerfSample,
  type LivePerfScenario,
  type RedrawCounts,
} from './live-perf.helpers';

const liveEnabled = process.env.DIFFSEEK_LIVE_E2E === '1';
const livePrUrl = process.env.DIFFSEEK_LIVE_PR_URL ?? defaultLivePrUrl;
const storageStateSource = process.env.DIFFSEEK_GITHUB_STORAGE_STATE;
const budgets = defaultLivePerfBudgets();
const samples = liveSampleCount();
const generatedCounter =
  '[data-diffseek-menu-count-action][data-viewed-facet="generated"][data-viewed-value="true"]';
const viewedFacetAction =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="viewed"][data-viewed-value="true"]';
const viewedToggle = '[data-filter-kind="viewed"][data-filter-value="true"]';
const stepTimeout = 20_000;
const panelsTimeout = 60_000;
const hotSettleMs = 500;

describeLive('live DiffSeek performance', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(1_800_000);

  let context: BrowserContext;
  const cold: LivePerfSample[] = [];
  const warm: LivePerfSample[] = [];
  const hot: LivePerfSample[] = [];
  const phases: Array<{ sample: number; phase: string } & RedrawCounts> = [];

  test.beforeAll(async () => {
    test.setTimeout(420_000);
    if (!storageStateSource) {
      test.skip(
        true,
        'Set DIFFSEEK_GITHUB_STORAGE_STATE to Playwright storageState JSON (inline secret or file path). Logged-out GitHub stays on classic /files and loops with DiffSeek /changes redirect.',
      );
      return;
    }
    const extension = resolve('.output/chrome-mv3');
    const userDataDir = await mkdtemp(join(tmpdir(), 'diffseek-live-e2e-'));
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
    const setup = await context.newPage();
    await setup.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await assertAuthenticatedReview(setup);
    await clearViewedFiles(setup);
    await setup.close();
  });

  test.afterAll(async () => {
    await context?.close();
    if (cold.length === 0) return;
    const report = {
      prUrl: livePrUrl,
      samples,
      cold,
      warm,
      hot,
      medians: {
        cold: medianSample(cold),
        warm: medianSample(warm),
        hot: medianSample(hot),
      },
      phases,
    };
    const outDir = resolve('.cache');
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, 'live-perf-latest.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const summary = process.env.GITHUB_STEP_SUMMARY;
    const markdown = livePerfSummary(report);
    if (summary) await appendFile(summary, `${markdown}\n`);
    console.log(markdown);
  });

  test('measures cold, warm, and hot reviews', async () => {
    for (let index = 0; index < samples; index += 1) {
      await clearExtensionStore(context);
      await writeShownDefaults(context);
      const page = await context.newPage();
      const coldSample = await measureReview(page, 'cold', async () => {
        await page.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
      });
      cold.push(coldSample);
      expect(rebuildFailures(coldSample, budgets)).toEqual([]);
      phases.push(
        { sample: index, phase: 'toggle-filter', ...(await runToggle(page)) },
        { sample: index, phase: 'mark-viewed', ...(await runMark(page)) },
      );

      const warmSample = await measureReview(page, 'warm', async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
      });
      warm.push(warmSample);
      expect(rebuildFailures(warmSample, budgets)).toEqual([]);

      await showConversation(page);
      const hotSample = await measureReview(page, 'hot', () => showFiles(page));
      hot.push(hotSample);
      expect(hotLossFailures(hotSample)).toEqual([]);
      await page.close();
    }

    for (const phase of phases) {
      expect(actionFailures(phase.phase, phase, budgets)).toEqual([]);
    }
    expect(medianBudgetFailures(cold, budgets)).toEqual([]);
    expect(medianBudgetFailures(warm, budgets)).toEqual([]);
    expect(medianBudgetFailures(hot, budgets)).toEqual([]);
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

async function measureReview(
  page: Page,
  scenario: LivePerfScenario,
  navigate: () => Promise<void>,
): Promise<LivePerfSample> {
  const started = Date.now();
  await navigate();
  await expect(page.locator('[data-diffseek-viewed-action]').first()).toBeVisible({
    timeout: panelsTimeout,
  });
  const firstRenderSeconds = await renderSeconds(page, started);
  // Conversation → Files changed rebuilds panels with no extension. Count
  // hot rebuilds only after DiffSeek has painted, and keep cold/warm at 0.
  if (scenario === 'hot') await resetRedraws(page);
  const menuOpenSeconds = await openFilterMenu(page);
  await expect(page.locator(generatedCounter)).toHaveText(
    generatedCategorizedPattern(expectedGeneratedTotal),
    { timeout: panelsTimeout },
  );
  const panelsSeconds = secondsBetween(started);
  if (scenario === 'hot') {
    await page.waitForTimeout(hotSettleMs);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('diffseek-redraw-settle'));
    });
  }
  const counts = await readRedraws(page);
  const sample: LivePerfSample = {
    scenario,
    firstRenderSeconds,
    menuOpenSeconds,
    panelsSeconds,
    ...counts,
  };
  test.info().annotations.push({
    type: `live-perf:${scenario}`,
    description: JSON.stringify(sample),
  });
  console.log(`diffseek live-perf:${scenario}`, sample);
  return sample;
}

async function runToggle(page: Page): Promise<RedrawCounts> {
  await closeFilterMenu(page);
  await resetRedraws(page);
  await openFilterMenu(page);
  const before = await readRedraws(page);
  await page.locator(viewedToggle).click({ timeout: stepTimeout });
  await expect
    .poll(async () => (await readRedraws(page)).reconciles, { timeout: stepTimeout })
    .toBeGreaterThan(before.reconciles);
  return subtractCounts(await readRedraws(page), before);
}

async function runMark(page: Page): Promise<RedrawCounts> {
  await resetRedraws(page);
  const before = await readRedraws(page);
  // Folders are treeitems too and contain their files' links. aria-expanded
  // is the folder control; the action must be this row's own icon, not a
  // descendant file, or the id selector matches every row in the folder.
  const row = page
    .locator('[role="treeitem"]:not([aria-expanded])')
    .filter({
      has: page.locator('[data-diffseek-viewed-action][aria-pressed="false"]'),
    })
    .first();
  await expect(row).toBeVisible({ timeout: stepTimeout });
  const action = await row.evaluateHandle((element) => {
    return (
      [...element.querySelectorAll<HTMLElement>('[data-diffseek-viewed-action]')].find(
        (node) =>
          node.closest('[role="treeitem"]') === element &&
          node.getAttribute('aria-pressed') === 'false',
      ) ?? null
    );
  });
  const target = action.asElement();
  if (!target) throw new Error('No unviewed file row to mark');
  await target.click({ timeout: stepTimeout });
  await expect
    .poll(() => target.getAttribute('aria-pressed'), { timeout: stepTimeout })
    .toBe('true');
  await action.dispose();
  return subtractCounts(await readRedraws(page), before);
}

async function showConversation(page: Page): Promise<void> {
  const conversation = page.getByRole('link', { name: /^Conversation/ });
  await expect(conversation.first(), `Conversation link missing at ${page.url()}`).toBeVisible({
    timeout: stepTimeout,
  });
  await conversation.first().click({ timeout: stepTimeout });
  await expect(page).toHaveURL(/\/pull\/\d+(?:[?#].*)?$/, { timeout: stepTimeout });
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(0, {
    timeout: stepTimeout,
  });
}

async function showFiles(page: Page): Promise<void> {
  const anchored = page.locator('#prs-files-anchor-tab');
  const files =
    (await anchored.count()) > 0
      ? anchored.first()
      : page.getByRole('link', { name: 'Files changed' }).first();
  await expect(files, `Files changed link missing at ${page.url()}`).toBeVisible({
    timeout: stepTimeout,
  });
  await files.click({ timeout: stepTimeout });
}

async function renderSeconds(page: Page, started: number): Promise<number> {
  const raw = await page.locator('html').getAttribute('data-diffseek-first-render-epoch');
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch >= started) {
    return Number(((epoch - started) / 1000).toFixed(3));
  }
  return secondsBetween(started);
}

function secondsBetween(started: number): number {
  return Number(((Date.now() - started) / 1000).toFixed(3));
}

async function readRedraws(page: Page): Promise<RedrawCounts> {
  const counts = await page.locator('html').evaluate((root) => {
    const data = root.dataset;
    const value = (key: string) => {
      const parsed = Number(data[key] ?? '0');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      reconciles: value('diffseekReconciles'),
      domMutations: value('diffseekDomMutations'),
      treeRebuilds: value('diffseekTreeRebuilds'),
      panelRebuilds: value('diffseekPanelRebuilds'),
      treeRowsRemoved: value('diffseekTreeRowsRemoved'),
      panelsRemoved: value('diffseekPanelsRemoved'),
      treeRowsReadded: value('diffseekTreeRowsReadded'),
      panelsReadded: value('diffseekPanelsReadded'),
      treeNetLoss: value('diffseekTreeNetLoss'),
      panelNetLoss: value('diffseekPanelNetLoss'),
    };
  });
  return counts;
}

async function resetRedraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('diffseek-redraw-reset'));
  });
}

function subtractCounts(after: RedrawCounts, before: RedrawCounts): RedrawCounts {
  return {
    reconciles: after.reconciles - before.reconciles,
    domMutations: after.domMutations - before.domMutations,
    treeRebuilds: after.treeRebuilds - before.treeRebuilds,
    panelRebuilds: after.panelRebuilds - before.panelRebuilds,
    treeRowsRemoved: after.treeRowsRemoved - before.treeRowsRemoved,
    panelsRemoved: after.panelsRemoved - before.panelsRemoved,
    treeRowsReadded: after.treeRowsReadded - before.treeRowsReadded,
    panelsReadded: after.panelsReadded - before.panelsReadded,
    treeNetLoss: after.treeNetLoss - before.treeNetLoss,
    panelNetLoss: after.panelNetLoss - before.panelNetLoss,
  };
}

async function assertAuthenticatedReview(page: Page): Promise<void> {
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
    'GitHub session from DIFFSEEK_GITHUB_STORAGE_STATE is not authenticated',
  ).toHaveCount(0, { timeout: stepTimeout });
  await expect(page).toHaveURL(/\/changes(\?|$)/, { timeout: stepTimeout });
  await expect(page.locator('[data-diffseek-viewed-action]').first()).toBeVisible({
    timeout: panelsTimeout,
  });
  await expect(page.getByLabel('Filter options')).toBeVisible({
    timeout: stepTimeout,
  });
}

async function openFilterMenu(page: Page): Promise<number> {
  const filters = page.locator('[data-diffseek="filters"]');
  const button = page.getByRole('button', { name: 'Filter options' });
  await expect(button).toBeVisible({ timeout: stepTimeout });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await filters.count()) > 0) return 0;
    await dismissCompactLinePopover(page);
    const started = Date.now();
    await button.click({ timeout: stepTimeout });
    try {
      await expect(filters).toHaveCount(1, { timeout: stepTimeout });
      return secondsBetween(started);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Filter menu did not open');
}

async function closeFilterMenu(page: Page): Promise<void> {
  if ((await page.locator('[data-diffseek="filters"]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(0, {
    timeout: stepTimeout,
  });
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

async function clearExtensionStore(browserContext: BrowserContext): Promise<void> {
  const worker = await extensionWorker(browserContext);
  await worker.evaluate(() => {
    const extension = globalThis as unknown as {
      chrome: { storage: { local: { clear: () => Promise<void> } } };
    };
    return extension.chrome.storage.local.clear();
  });
}

/** Explicit shown preference. An absent key is the fresh-install hide default. */
async function writeShownDefaults(browserContext: BrowserContext): Promise<void> {
  const worker = await extensionWorker(browserContext);
  await worker.evaluate(() => {
    const extension = globalThis as unknown as {
      chrome: {
        storage: {
          local: { set: (items: Record<string, unknown>) => Promise<void> };
        };
      };
    };
    return extension.chrome.storage.local.set({
      'diffseek:filter-defaults': { hidden: [], viewed: [] },
    });
  });
}

async function extensionWorker(browserContext: BrowserContext) {
  return (
    browserContext.serviceWorkers()[0] ??
    (await browserContext.waitForEvent('serviceworker', { timeout: stepTimeout }))
  );
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
