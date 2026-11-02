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
  generatedIndexedText,
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
} from './live-perf.support';
import {
  installLiveWaits,
  tagFilterButton,
  untilAttribute,
  untilDom,
} from './live-wait';

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
const panelsTimeout = 90_000;
// Fresh-install hiding without auto-view, which would mark the fixture's
// generated files viewed on GitHub. Unit tests cover the auto-view default.
const hideDefaults = { hidden: ['viewed', 'generated'], viewed: [] };

test.describe('live DiffSeek performance', () => {
  if (!liveEnabled) return;
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(1_800_000);

  let context: BrowserContext;
  const cold: LivePerfSample[] = [];
  const warm: LivePerfSample[] = [];
  const hot: LivePerfSample[] = [];
  const phases: Array<{ sample: number; phase: string } & RedrawCounts> = [];

  test.beforeAll(async () => {
    test.setTimeout(420_000);
    if (storageStateSource == null || storageStateSource === '') {
      throw new Error(
        'Set DIFFSEEK_GITHUB_STORAGE_STATE to Playwright storageState JSON (inline secret or file path). Logged-out GitHub stays on classic /files and loops with DiffSeek /changes redirect.',
      );
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
    await installLiveWaits(context);
    // Auto-view would mark the fixture's generated files viewed on GitHub.
    await writeShownDefaults(context);
    const setup = await context.newPage();
    await setup.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await assertAuthenticatedReview(setup);
    await clearViewedFiles(setup);
    await setup.close();
  });

  test.afterAll(async () => {
    await context.close();
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
      // Cold expects exactly 1 tree and panel rebuild: GitHub's own broken
      // cold-load redraw since 2026-10-31 (see defaultLivePerfBudgets).
      expect(rebuildFailures(coldSample, budgets)).toEqual([]);
      phases.push(
        { sample: index, phase: 'toggle-filter', ...(await runToggle(page)) },
        { sample: index, phase: 'mark-viewed', ...(await runMark(page)) },
      );

      const warmSample = await measureReview(page, 'warm', async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
      });
      warm.push(warmSample);
      // Warm also expects exactly 1: the same GitHub redraw on reload.
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

  test('hide defaults hide generated and viewed files until shown', async () => {
    await clearExtensionStore(context);
    await writeDefaults(context, hideDefaults);
    const page = await context.newPage();
    await page.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await openFilterMenu(page, panelsTimeout);
    const viewed = page.locator(viewedToggle);
    const generated = page.locator(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    );
    const generatedToggle = '[data-filter-kind="generated"][data-filter-value="true"]';
    const generatedCountSelector =
      '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count';
    await untilDom(page, { kind: 'attr', selector: viewedToggle, name: 'aria-checked', value: 'mixed' }, stepTimeout, 'viewed toggle mixed');
    await untilDom(page, { kind: 'attr', selector: generatedToggle, name: 'aria-checked', value: 'mixed' }, panelsTimeout, 'generated toggle mixed');
    await untilDom(page, { kind: 'text', selector: generatedCountSelector, pattern: `^0/${expectedGeneratedTotal}$` }, panelsTimeout, 'generated count hidden');
    await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 0 },
    );

    await viewed.click();
    await untilDom(page, { kind: 'attr', selector: viewedToggle, name: 'aria-checked', value: 'true' }, stepTimeout, 'viewed toggle on');
    await generated.click();
    await untilDom(page, { kind: 'attr', selector: generatedToggle, name: 'aria-checked', value: 'true' }, stepTimeout, 'generated toggle on');
    await untilDom(page, { kind: 'text', selector: generatedCountSelector, pattern: `^${generatedIndexedText(expectedGeneratedTotal)}$` }, panelsTimeout, 'generated count shown');
    await page.close();
  });
});

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
  await untilDom(page, { kind: 'present', selector: '[data-diffseek-viewed-action]' }, panelsTimeout, 'first DiffSeek control');
  const firstRenderSeconds = await renderSeconds(page, started);
  // GitHub removes and restores panels on this navigation. Hot starts
  // counting here and later fails on rows back after 500 ms or never back.
  if (scenario === 'hot') await resetRedraws(page);
  const menuOpenSeconds = await openFilterMenu(page);
  await untilDom(
    page,
    { kind: 'text', selector: generatedCounter, pattern: generatedCategorizedPattern(expectedGeneratedTotal).source },
    panelsTimeout,
    'generated counter categorized',
  );
  const panelsSeconds = secondsBetween(started);
  if (scenario === 'hot') {
    // Wait for every removed row to return (event), not a fixed delay. The
    // trace still timestamps returns: one back after 500 ms is a net loss.
    // A row that never returns trips the guard and is then counted as lost.
    await untilDom(page, { kind: 'trace-settled' }, stepTimeout, 'hot rows returned').catch(() => undefined);
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
  await untilDom(page, { kind: 'dataset-above', key: 'diffseekReconciles', value: before.reconciles }, stepTimeout, 'toggle reconcile');
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
  await untilDom(page, { kind: 'unviewed-file-row' }, stepTimeout, 'unviewed file row');
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
  await untilAttribute(target, 'aria-pressed', 'true', stepTimeout, 'file marked viewed');
  await action.dispose();
  return subtractCounts(await readRedraws(page), before);
}

async function showConversation(page: Page): Promise<void> {
  const conversation = page.getByRole('link', { name: /^Conversation/ });
  await untilDom(page, { kind: 'link-prefix', prefix: 'Conversation' }, stepTimeout, `Conversation link missing at ${page.url()}`);
  await conversation.first().click({ timeout: stepTimeout });
  await page.waitForURL(/\/pull\/\d+(?:[?#].*)?$/, { timeout: stepTimeout });
  await untilDom(page, { kind: 'absent', selector: '[data-diffseek-viewed-action]' }, stepTimeout, 'DiffSeek controls gone');
}

async function showFiles(page: Page): Promise<void> {
  await untilDom(page, { kind: 'present', selector: '#prs-files-anchor-tab, a[href*="/changes"], a[href$="/files"]' }, stepTimeout, `Files changed link missing at ${page.url()}`);
  const anchored = page.locator('#prs-files-anchor-tab');
  const files =
    (await anchored.count()) > 0
      ? anchored.first()
      : page.getByRole('link', { name: 'Files changed' }).first();
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
  ).toHaveCount(0);
  await page.waitForURL(/\/changes(\?|$)/, { timeout: stepTimeout });
  await untilDom(page, { kind: 'present', selector: '[data-diffseek-viewed-action]' }, panelsTimeout, 'first DiffSeek control');
  await untilDom(page, { kind: 'filter-button-ready' }, stepTimeout, 'Filter options button interactive');
}

async function openFilterMenu(page: Page, guardMs = stepTimeout): Promise<number> {
  const filters = page.locator('[data-diffseek="filters"]');
  if ((await filters.count()) > 0) return 0;
  // GitHub server-renders this button and later swaps in a client-rendered
  // copy; clicks on the server copy do nothing. Wait for the interactive copy.
  await untilDom(page, { kind: 'filter-button-ready' }, guardMs, 'Filter options button interactive');
  const button = page.getByRole('button', { name: 'Filter options' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissCompactLinePopover(page);
    await tagFilterButton(page);
    const started = Date.now();
    await button.click({ timeout: stepTimeout });
    // Re-click only on an event: GitHub replaced the button under the click.
    const outcome = await untilDom(page, { kind: 'filter-menu-or-replaced' }, stepTimeout, 'Filter menu did not open');
    if (outcome === 'open') return secondsBetween(started);
  }
  throw new Error('Filter options button kept being replaced');
}

async function closeFilterMenu(page: Page): Promise<void> {
  if ((await page.locator('[data-diffseek="filters"]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await untilDom(page, { kind: 'absent', selector: '[data-diffseek="filters"]' }, stepTimeout, 'filter menu closed');
}

async function dismissCompactLinePopover(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const popover of document.querySelectorAll(
      '[data-component="Popover"][data-open]',
    )) {
      if (popover.textContent.includes('compact line height')) popover.remove();
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

/** Explicit shown preference with auto-view off. An absent key is a fresh install. */
async function writeShownDefaults(browserContext: BrowserContext): Promise<void> {
  await writeDefaults(browserContext, { hidden: [], viewed: [] });
}

async function writeDefaults(
  browserContext: BrowserContext,
  defaults: { hidden: string[]; viewed: string[] },
): Promise<void> {
  const worker = await extensionWorker(browserContext);
  await worker.evaluate((value) => {
    const extension = globalThis as unknown as {
      chrome: {
        storage: {
          local: { set: (items: Record<string, unknown>) => Promise<void> };
        };
      };
    };
    return extension.chrome.storage.local.set({
      'diffseek:filter-defaults': value,
    });
  }, defaults);
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
  if (label !== 'Unmark all') return;
  await action.click();
  await untilDom(
    page,
    { kind: 'text', selector: '[data-diffseek="snackbar"]', pattern: "^(All files in category unmarked|Couldn't unmark files\\. Try again\\.)$" },
    300_000,
    'not-viewed snackbar',
  );
}
