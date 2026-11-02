import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from '@playwright/test';

import { envValue } from '@diffseek/browser/env';
import '@diffseek/browser/page-globals';

import {
  actionFailures,
  defaultLivePerfBudgets,
  defaultLivePrUrl,
  expectedGeneratedTotal,
  generatedCategorizedPattern,
  generatedIndexedText,
  hotLossFailures,
  isInlineStorageState,
  type LivePerfSample,
  type LivePerfScenario,
  livePerfSummary,
  liveSampleCount,
  medianBudgetFailures,
  medianSample,
  parseInlineStorageState,
  parseStorageCookies,
  rebuildFailures,
  type RedrawCounts,
} from './live-perf.helpers';
import {
  type DomCondition,
  installLiveWaits,
  tagFilterButton,
  untilAttribute,
  untilDom,
} from './live-wait';

const livePrUrl = envValue(process.env, 'DIFFSEEK_LIVE_PR_URL') ?? defaultLivePrUrl;
const budgets = defaultLivePerfBudgets();
const samples = liveSampleCount();
const generatedCounter =
  '[data-diffseek-menu-count-action][data-viewed-facet="generated"][data-viewed-value="true"]';
const viewedFacetAction =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="viewed"][data-viewed-value="true"]';
const viewedToggle = '[data-filter-kind="viewed"][data-filter-value="true"]';
const stepTimeout = 20_000;
const panelsTimeout = 90_000;
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

async function assertAuthenticatedReview(page: Page): Promise<void> {
  await expect(
    page.getByRole('link', { exact: true, name: 'Sign in' }),
    'GitHub session from DIFFSEEK_GITHUB_STORAGE_STATE is not authenticated',
  ).toHaveCount(0);
  await page.waitForURL(/\/changes(\?|$)/v, { timeout: stepTimeout });
  await domWait(page, { kind: 'present', selector: '[data-diffseek-viewed-action]' }, panelsTimeout, 'first DiffSeek control');
  await domWait(page, { kind: 'filter-button-ready' }, stepTimeout, 'Filter options button interactive');
}

async function clearExtensionStore(browserContext: BrowserContext): Promise<void> {
  const worker = await extensionWorker(browserContext);
  await worker.evaluate(() => globalThis.chrome.storage.local.clear());
}

async function clearViewedFiles(page: Page): Promise<void> {
  await openFilterMenu(page);
  const action = page.locator(viewedFacetAction);
  if ((await action.count()) === 0) return;
  const label = await action.getAttribute('aria-label', { timeout: 5_000 });
  if (label !== 'Unmark all') return;
  await action.click();
  await domWait(
    page,
    { kind: 'text', pattern: "^(All files in category unmarked|Couldn't unmark files\\. Try again\\.)$", selector: '[data-diffseek="snackbar"]' },
    300_000,
    'not-viewed snackbar',
  );
}

async function closeFilterMenu(page: Page): Promise<void> {
  if ((await page.locator('[data-diffseek="filters"]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await domWait(page, { kind: 'absent', selector: '[data-diffseek="filters"]' }, stepTimeout, 'filter menu closed');
}

async function dismissCompactLinePopover(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const popover of globalThis.document.querySelectorAll(
      '[data-component="Popover"][data-open]',
    )) {
      if (popover.textContent.includes('compact line height')) popover.remove();
    }
  });
}

function domWait(
  page: Page,
  condition: DomCondition,
  ms: number,
  message: string,
): Promise<unknown> {
  return untilDom(page, condition, { message, ms });
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
    await domWait(page, { kind: 'attr', name: 'aria-checked', selector: viewedToggle, value: 'mixed' }, stepTimeout, 'viewed toggle mixed');
    await domWait(page, { kind: 'attr', name: 'aria-checked', selector: generatedToggle, value: 'mixed' }, panelsTimeout, 'generated toggle mixed');
    await domWait(page, { kind: 'text', pattern: `^0/${expectedGeneratedTotal}$`, selector: generatedCountSelector }, panelsTimeout, 'generated count hidden');
    await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 0 },
    );

    await viewed.click();
    await domWait(page, { kind: 'attr', name: 'aria-checked', selector: viewedToggle, value: 'true' }, stepTimeout, 'viewed toggle on');
    await generated.click();
    await domWait(page, { kind: 'attr', name: 'aria-checked', selector: generatedToggle, value: 'true' }, stepTimeout, 'generated toggle on');
    await domWait(page, { kind: 'text', pattern: `^${generatedIndexedText(expectedGeneratedTotal)}$`, selector: generatedCountSelector }, panelsTimeout, 'generated count shown');
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
  await domWait(page, { kind: 'present', selector: '[data-diffseek-viewed-action]' }, panelsTimeout, 'first DiffSeek control');
  const firstRenderSeconds = await renderSeconds(page, started);
  // GitHub removes and restores panels on this navigation. Hot starts
  // counting here and later fails on rows back after 500 ms or never back.
  if (scenario === 'hot') await resetRedraws(page);
  const menuOpenSeconds = await openFilterMenu(page);
  await domWait(
    page,
    { kind: 'text', pattern: generatedCategorizedPattern(expectedGeneratedTotal).source, selector: generatedCounter },
    panelsTimeout,
    'generated counter categorized',
  );
  const panelsSeconds = secondsBetween(started);
  if (scenario === 'hot') {
    // Wait for every removed row to return (event), not a fixed delay. The
    // trace still timestamps returns: one back after 500 ms is a net loss.
    // A row that never returns trips the guard and is then counted as lost.
    try {
      await domWait(page, { kind: 'trace-settled' }, stepTimeout, 'hot rows returned');
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

async function openFilterMenu(page: Page, guardMs = stepTimeout): Promise<number> {
  const filters = page.locator('[data-diffseek="filters"]');
  if ((await filters.count()) > 0) return 0;
  // GitHub server-renders this button and later swaps in a client-rendered
  // copy; clicks on the server copy do nothing. Wait for the interactive copy.
  await domWait(page, { kind: 'filter-button-ready' }, guardMs, 'Filter options button interactive');
  const button = page.getByRole('button', { name: 'Filter options' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissCompactLinePopover(page);
    await tagFilterButton(page);
    const started = Date.now();
    await button.click({ timeout: stepTimeout });
    // Re-click only on an event: GitHub replaced the button under the click.
    const outcome = await domWait(page, { kind: 'filter-menu-or-replaced' }, stepTimeout, 'Filter menu did not open');
    if (outcome === 'open') return secondsBetween(started);
  }
  throw new Error('Filter options button kept being replaced');
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
        `Failed to load DIFFSEEK_GITHUB_STORAGE_STATE: ${Error.isError(error) ? error.message : String(error)}`,
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

async function readRedraws(page: Page): Promise<RedrawCounts> {
  const counts = await page.locator('html').evaluate((root) => {
    const data = root.dataset;
    const value = (key: string): number => {
      const parsed = Number(data[key] ?? '0');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      domMutations: value('diffseekDomMutations'),
      panelNetLoss: value('diffseekPanelNetLoss'),
      panelRebuilds: value('diffseekPanelRebuilds'),
      panelsReadded: value('diffseekPanelsReadded'),
      panelsRemoved: value('diffseekPanelsRemoved'),
      reconciles: value('diffseekReconciles'),
      treeNetLoss: value('diffseekTreeNetLoss'),
      treeRebuilds: value('diffseekTreeRebuilds'),
      treeRowsReadded: value('diffseekTreeRowsReadded'),
      treeRowsRemoved: value('diffseekTreeRowsRemoved'),
    };
  });
  return counts;
}

function registerLivePerf(): void {
  if (envValue(process.env, 'DIFFSEEK_LIVE_E2E') !== '1') return;
  const source = envValue(process.env, 'DIFFSEEK_GITHUB_STORAGE_STATE');
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

async function renderSeconds(page: Page, started: number): Promise<number> {
  const raw = await page.locator('html').getAttribute('data-diffseek-first-render-epoch');
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch >= started) {
    return Number(((epoch - started) / 1000).toFixed(3));
  }
  return secondsBetween(started);
}

async function resetRedraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.document.dispatchEvent(new Event('diffseek-redraw-reset'));
  });
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
  await domWait(page, { kind: 'unviewed-file-row' }, stepTimeout, 'unviewed file row');
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
  await untilAttribute(target, { name: 'aria-pressed', value: 'true' }, {
    message: 'file marked viewed',
    ms: stepTimeout,
  });
  await action.dispose();
  return subtractCounts(await readRedraws(page), before);
}

async function runToggle(page: Page): Promise<RedrawCounts> {
  await closeFilterMenu(page);
  await resetRedraws(page);
  await openFilterMenu(page);
  const before = await readRedraws(page);
  await page.locator(viewedToggle).click({ timeout: stepTimeout });
  await domWait(page, { key: 'diffseekReconciles', kind: 'dataset-above', value: before.reconciles }, stepTimeout, 'toggle reconcile');
  return subtractCounts(await readRedraws(page), before);
}

function secondsBetween(started: number): number {
  return Number(((Date.now() - started) / 1000).toFixed(3));
}

async function showConversation(page: Page): Promise<void> {
  const conversation = page.getByRole('link', { name: /^Conversation/v });
  await domWait(page, { kind: 'link-prefix', prefix: 'Conversation' }, stepTimeout, `Conversation link missing at ${page.url()}`);
  await conversation.first().click({ timeout: stepTimeout });
  await page.waitForURL(/\/pull\/\d+(?:[?#].*)?$/v, { timeout: stepTimeout });
  await domWait(page, { kind: 'absent', selector: '[data-diffseek-viewed-action]' }, stepTimeout, 'DiffSeek controls gone');
}

async function showFiles(page: Page): Promise<void> {
  await domWait(page, { kind: 'present', selector: '#prs-files-anchor-tab, a[href*="/changes"], a[href$="/files"]' }, stepTimeout, `Files changed link missing at ${page.url()}`);
  const anchored = page.locator('#prs-files-anchor-tab');
  const files =
    (await anchored.count()) > 0
      ? anchored.first()
      : page.getByRole('link', { name: 'Files changed' }).first();
  await files.click({ timeout: stepTimeout });
}

function subtractCounts(after: RedrawCounts, before: RedrawCounts): RedrawCounts {
  return {
    domMutations: after.domMutations - before.domMutations,
    panelNetLoss: after.panelNetLoss - before.panelNetLoss,
    panelRebuilds: after.panelRebuilds - before.panelRebuilds,
    panelsReadded: after.panelsReadded - before.panelsReadded,
    panelsRemoved: after.panelsRemoved - before.panelsRemoved,
    reconciles: after.reconciles - before.reconciles,
    treeNetLoss: after.treeNetLoss - before.treeNetLoss,
    treeRebuilds: after.treeRebuilds - before.treeRebuilds,
    treeRowsReadded: after.treeRowsReadded - before.treeRowsReadded,
    treeRowsRemoved: after.treeRowsRemoved - before.treeRowsRemoved,
  };
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
    const summary = envValue(process.env, 'GITHUB_STEP_SUMMARY');
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
