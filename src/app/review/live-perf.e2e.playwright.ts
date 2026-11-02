import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from '@playwright/test';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import '@diffseek/browser/page-globals';

import {
  actionFailures,
  defaultLivePerfBudgets,
  defaultLivePrUrl,
  expectedGeneratedTotal,
  generatedCategorizedPattern,
  generatedIndexedText,
  hotLossFailures,
  type LivePerfSample,
  type LivePerfScenario,
  livePerfSummary,
  liveSampleCount,
  medianBudgetFailures,
  medianSample,
  rebuildFailures,
  type RedrawCounts,
  secondsBetween,
} from './live-perf.helpers';
import {
  assertAuthenticatedReview,
  clearViewedFiles,
  openFilterMenu,
  panelsTimeout,
  readRedraws,
  renderSeconds,
  resetRedraws,
  runMark,
  runToggle,
  showConversation,
  showFiles,
  stepTimeout,
  untilFirstControl,
  viewedToggle,
} from './live-perf.support';
import {
  isInlineStorageState,
  parseInlineStorageState,
  parseStorageCookies,
} from './live-storage-state';
import { installLiveWaits, untilDom } from './live-wait';

const livePrUrl = process.env['DIFFSEEK_LIVE_PR_URL'] ?? defaultLivePrUrl;
const budgets = defaultLivePerfBudgets();
const samples = liveSampleCount();
const generatedCounter =
  '[data-diffseek-menu-count-action][data-viewed-facet="generated"][data-viewed-value="true"]';
// Fresh-install hiding without auto-view, which would mark the fixture's
// generated files viewed on GitHub. Unit tests cover the auto-view default.
const hideDefaults = { hidden: ['viewed', 'generated'], viewed: [] };
const liveRun: {
  context?: BrowserContext;
  storageStateSource: string;
} = { storageStateSource: '' };
const cold: LivePerfSample[] = [];
const warm: LivePerfSample[] = [];
const hot: LivePerfSample[] = [];
const phases: (RedrawCounts & { phase: string; sample: number })[] = [];

registerLivePerf();

async function clearExtensionStore(browserContext: BrowserContext): Promise<void> {
  const worker = await extensionWorker(browserContext);
  await worker.evaluate(() => globalThis.chrome.storage.local.clear());
}

async function extensionWorker(browserContext: BrowserContext): Promise<Worker> {
  return (
    browserContext.serviceWorkers()[0] ??
    (await browserContext.waitForEvent('serviceworker', { timeout: stepTimeout }))
  );
}

function liveBrowser(): BrowserContext {
  if (liveRun.context === undefined) throw new Error('Live browser was not started');
  return liveRun.context;
}

async function loadStorageState(source: string): Promise<unknown> {
  if (isInlineStorageState(source)) return parseInlineStorageState(source);
  return JSON.parse(await readFile(source, 'utf8'));
}

async function measureHiddenDefaults(): Promise<void> {
    const browser = liveBrowser();
    await clearExtensionStore(browser);
    await writeDefaults(browser, hideDefaults);
    const page = await browser.newPage();
    await page.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await openFilterMenu(page, panelsTimeout);
    const viewed = page.locator(viewedToggle);
    const generated = page.locator(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    );
    const generatedToggle = '[data-filter-kind="generated"][data-filter-value="true"]';
    const generatedCountSelector =
      '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count';
    await untilDom(page, { kind: 'attr', name: 'aria-checked', selector: viewedToggle, value: 'mixed' }, { message: 'viewed toggle mixed', ms: stepTimeout });
    await untilDom(page, { kind: 'attr', name: 'aria-checked', selector: generatedToggle, value: 'mixed' }, { message: 'generated toggle mixed', ms: panelsTimeout });
    await untilDom(page, { kind: 'text', pattern: `^0/${String(expectedGeneratedTotal)}$`, selector: generatedCountSelector }, { message: 'generated count hidden', ms: panelsTimeout });
    await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 0 },
    );

    await viewed.click();
    await untilDom(page, { kind: 'attr', name: 'aria-checked', selector: viewedToggle, value: 'true' }, { message: 'viewed toggle on', ms: stepTimeout });
    await generated.click();
    await untilDom(page, { kind: 'attr', name: 'aria-checked', selector: generatedToggle, value: 'true' }, { message: 'generated toggle on', ms: stepTimeout });
    await untilDom(page, { kind: 'text', pattern: `^${generatedIndexedText(expectedGeneratedTotal)}$`, selector: generatedCountSelector }, { message: 'generated count shown', ms: panelsTimeout });
    await page.close();
}

async function measureLiveReviews(): Promise<void> {
    const browser = liveBrowser();
    for (let index = 0; index < samples; index += 1) {
      await clearExtensionStore(browser);
      await writeShownDefaults(browser);
      const page = await browser.newPage();
      const coldSample = await measureReview(page, 'cold', async (): Promise<void> => {
        await page.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
      });
      cold.push(coldSample);
      // Cold expects exactly 1 tree and panel rebuild: GitHub's own broken
      // cold-load redraw since 2026-10-31 (see defaultLivePerfBudgets).
      expect(rebuildFailures(coldSample, budgets)).toEqual([]);
      phases.push(
        { phase: 'toggle-filter', sample: index, ...(await runToggle(page)) },
        { phase: 'mark-viewed', sample: index, ...(await runMark(page)) },
      );

      const warmSample = await measureReview(page, 'warm', async (): Promise<void> => {
        await page.reload({ waitUntil: 'domcontentloaded' });
      });
      warm.push(warmSample);
      // Warm also expects exactly 1: the same GitHub redraw on reload.
      expect(rebuildFailures(warmSample, budgets)).toEqual([]);

      await showConversation(page);
      const hotSample = await measureReview(page, 'hot', (): Promise<void> => showFiles(page));
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
}

async function measureReview(
  page: Page,
  scenario: LivePerfScenario,
  navigate: () => Promise<void>,
): Promise<LivePerfSample> {
  const started = Date.now();
  await navigate();
  await untilFirstControl(page);
  const firstRenderSeconds = await renderSeconds(page, started);
  // GitHub removes and restores panels on this navigation. Hot starts
  // counting here and later fails on rows back after 500 ms or never back.
  if (scenario === 'hot') await resetRedraws(page);
  const menuOpenSeconds = await openFilterMenu(page);
  await untilDom(
    page,
    { kind: 'text', pattern: generatedCategorizedPattern(expectedGeneratedTotal).source, selector: generatedCounter },
    { message: 'generated counter categorized', ms: panelsTimeout },
  );
  const panelsSeconds = secondsBetween(started);
  if (scenario === 'hot') {
    // Wait for every removed row to return (event), not a fixed delay. The
    // trace still timestamps returns: one back after 500 ms is a net loss.
    // A row that never returns trips the guard and is then counted as lost.
    try {
      await untilDom(page, { kind: 'trace-settled' }, { message: 'hot rows returned', ms: stepTimeout });
    } catch {
      // A row that never returns is counted after the guard.
    }
    await page.evaluate(() => {
      globalThis.document.dispatchEvent(new Event('diffseek-redraw-settle'));
    });
  }
  const counts = await readRedraws(page);
  const sample: LivePerfSample = {
    firstRenderSeconds,
    menuOpenSeconds,
    panelsSeconds,
    scenario,
    ...counts,
  };
  test.info().annotations.push({
    description: JSON.stringify(sample),
    type: `live-perf:${scenario}`,
  });
  console.log(`diffseek live-perf:${scenario}`, sample);
  return sample;
}

async function prepareLiveContext(): Promise<void> {
    test.setTimeout(420_000);
    const extension = path.resolve('.output/chrome-mv3');
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'diffseek-live-e2e-'));
    liveRun.context = await chromium.launchPersistentContext(userDataDir, {
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      channel: 'chromium',
      headless: true,
    });
    let raw: unknown;
    try {
      raw = await loadStorageState(liveRun.storageStateSource);
    } catch (error) {
      throw new Error(
        `Failed to load DIFFSEEK_GITHUB_STORAGE_STATE: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const browser = liveBrowser();
    await browser.addCookies(parseStorageCookies(raw));
    await installLiveWaits(browser);
    // Auto-view would mark the fixture's generated files viewed on GitHub.
    await writeShownDefaults(browser);
    const setup = await browser.newPage();
    await setup.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await assertAuthenticatedReview(setup);
    await clearViewedFiles(setup);
    await setup.close();
}

function registerLivePerf(): void {
  if (process.env['DIFFSEEK_LIVE_E2E'] !== '1') return;
  const source = process.env['DIFFSEEK_GITHUB_STORAGE_STATE'];
  if (source === undefined || source === '') {
    throw new Error(
      'Set DIFFSEEK_GITHUB_STORAGE_STATE to Playwright storageState JSON (inline secret or file path). Logged-out GitHub stays on classic /files and loops with DiffSeek /changes redirect.',
    );
  }
  liveRun.storageStateSource = source;

  test.describe('live DiffSeek performance', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(1_800_000);

    test.beforeAll(prepareLiveContext);

    test.afterAll(writeLiveReport);

    test('measures cold, warm, and hot reviews', measureLiveReviews);
    test('hide defaults hide generated and viewed files until shown', measureHiddenDefaults);
  });
}

async function writeDefaults(
  browserContext: BrowserContext,
  defaults: { hidden: string[]; viewed: string[] },
): Promise<void> {
  const worker = await extensionWorker(browserContext);
  await worker.evaluate((value) => {
    return globalThis.chrome.storage.local.set({
      'diffseek:filter-defaults': value,
    });
  }, defaults);
}

async function writeLiveReport(): Promise<void> {
    if (liveRun.context !== undefined) await liveRun.context.close();
    if (cold.length === 0) return;
    const report = {
      cold,
      hot,
      medians: {
        cold: medianSample(cold),
        hot: medianSample(hot),
        warm: medianSample(warm),
      },
      phases,
      prUrl: livePrUrl,
      samples,
      warm,
    };
    const outDir = path.resolve('.cache');
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, 'live-perf-latest.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    const markdown = livePerfSummary(report);
    if (summary !== undefined && summary !== '') {
      await appendFile(summary, `${markdown}\n`);
    }
    console.log(markdown);
}

/** Explicit shown preference with auto-view off. An absent key is a fresh install. */
async function writeShownDefaults(browserContext: BrowserContext): Promise<void> {
  await writeDefaults(browserContext, { hidden: [], viewed: [] });
}
