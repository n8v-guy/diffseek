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

describeLive('live DiffSeek performance', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(1_800_000);

  let context: BrowserContext;
  const cold: LivePerfSample[] = [];
  const warm: LivePerfSample[] = [];
  const hot: LivePerfSample[] = [];
  const phases: Array<{ sample: number; phase: string } & RedrawCounts> = [];

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
      const hotSample = await measureReview(page, 'hot', async () => {
        await resetRedraws(page);
        await page.locator('#files_tab').click();
      });
      hot.push(hotSample);
      expect(rebuildFailures(hotSample, budgets)).toEqual([]);
      await page.close();
    }

    for (const phase of phases) {
      expect(actionFailures(phase.phase, phase, budgets)).toEqual([]);
    }
    expect(medianBudgetFailures(medianSample(cold), budgets)).toEqual([]);
    expect(medianBudgetFailures(medianSample(warm), budgets)).toEqual([]);
    expect(medianBudgetFailures(medianSample(hot), budgets)).toEqual([]);
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
    timeout: 120_000,
  });
  const firstRenderSeconds = await renderSeconds(page, started);
  const menuOpenSeconds = await openFilterMenu(page);
  await expect(page.locator(generatedCounter)).toHaveText(
    generatedCategorizedPattern(expectedGeneratedTotal),
    { timeout: 120_000 },
  );
  const counts = await readRedraws(page);
  const sample: LivePerfSample = {
    scenario,
    firstRenderSeconds,
    menuOpenSeconds,
    panelsSeconds: secondsBetween(started),
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
  await page.locator(viewedToggle).click();
  await expect
    .poll(async () => (await readRedraws(page)).reconciles)
    .toBeGreaterThan(before.reconciles);
  return subtractCounts(await readRedraws(page), before);
}

async function runMark(page: Page): Promise<RedrawCounts> {
  await resetRedraws(page);
  const before = await readRedraws(page);
  const action = page.locator('[data-diffseek-viewed-action][aria-pressed="false"]').first();
  await action.click();
  await expect(action).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  return subtractCounts(await readRedraws(page), before);
}

async function showConversation(page: Page): Promise<void> {
  const conversation = page.locator('#conversation_tab');
  const files = page.locator('#files_tab');
  if ((await conversation.count()) === 0 || (await files.count()) === 0) {
    const tabs = await page.locator('.tabnav').first().innerText().catch(() => '');
    throw new Error(`PR tabs missing at ${page.url()}: ${tabs}`);
  }
  await conversation.click();
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(0, {
    timeout: 60_000,
  });
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
  };
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
  const started = Date.now();
  const filters = page.locator('[data-diffseek="filters"]');
  const button = page.getByRole('button', { name: 'Filter options' });
  for (let attempt = 0; attempt < 8 && (await filters.count()) === 0; attempt += 1) {
    await dismissCompactLinePopover(page);
    await button.click({ delay: 80 }).catch(() => undefined);
  }
  await expect(filters).toHaveCount(1, { timeout: 60_000 });
  return secondsBetween(started);
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
