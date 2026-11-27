import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';

import {
  actionFailures,
  defaultLivePerfBudgets,
  defaultLivePrUrl,
  emptyChurnSamples,
  emptyGithubRequestCounts,
  expectedGeneratedTotal,
  generatedCategorizedPattern,
  generatedIndexedText,
  githubChurnFailures,
  hotLossFailures,
  isInlineStorageState,
  livePerfScenarios,
  livePerfSummary,
  liveSampleCount,
  liveSteps,
  medianBudgetFailures,
  medianSample,
  noteGithubRequest,
  parseInlineStorageState,
  parseStorageCookies,
  rebuildFailures,
  type ChurnSamples,
  type LivePerfSample,
  type LivePerfScenario,
  type LiveStep,
  type RedrawCounts,
} from './live-perf.support';
import {
  installLiveWaits,
  readChurn,
  resetChurn,
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
const unmarkViewedCounter =
  '[data-diffseek-menu-count-action][data-viewed-facet="viewed"][aria-label="Unmark all"]';
const viewedProgress = '[class*="hide-viewed-progress-on-small"] .sr-only';
const viewedProgressTotal = ' of [1-9]\\d* files viewed$';
const snackbar = '[data-diffseek="snackbar"]';
const filesViewMarks = `[data-diffseek-viewed-action], ${viewedProgress}`;
const viewedToggle = '[data-filter-kind="viewed"][data-filter-value="true"]';
const generatedToggle = '[data-filter-kind="generated"][data-filter-value="true"]';
const stepTimeout = 20_000;
const panelsTimeout = 90_000;
// Fresh-install hiding without auto-view, which would mark the fixture's
// generated files viewed on GitHub. Unit tests cover the auto-view default.
const hideDefaults = { hidden: ['viewed', 'generated'], viewed: [] };
const githubChurn = emptyChurnSamples();

test.describe('live DiffSeek performance', () => {
  if (!liveEnabled) return;
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(1_800_000);

  let activeContext: BrowserContext | undefined;
  let cookies: ReturnType<typeof parseStorageCookies>;
  const loads = Object.fromEntries(
    livePerfScenarios.map((scenario) => [scenario, [] as LivePerfSample[]]),
  ) as Record<LivePerfScenario, LivePerfSample[]>;
  const phases: Array<{ sample: number; phase: string } & RedrawCounts> = [];

  /** GitHub alone cannot unmark every file, so its profile must start with none viewed. */
  async function startCleanContext(withDiffseek = true): Promise<BrowserContext> {
    await activeContext?.close();
    const extension = resolve('.output/chrome-mv3');
    activeContext = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: withDiffseek
        ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
        : [],
    });
    await activeContext.addCookies(cookies);
    await installLiveWaits(activeContext);
    if (withDiffseek) await writeShownDefaults(activeContext);
    const setup = await activeContext.newPage();
    await setup.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    if (withDiffseek) {
      await assertAuthenticatedReview(setup);
      await clearViewedFiles(setup);
    } else {
      await untilNoViewedFiles(setup, 'before a GitHub-only sample');
    }
    await setup.close();
    return activeContext;
  }

  test.beforeAll(async () => {
    test.setTimeout(420_000);
    if (storageStateSource == null || storageStateSource === '') {
      throw new Error(
        'Set DIFFSEEK_GITHUB_STORAGE_STATE to Playwright storageState JSON (inline secret or file path). Logged-out GitHub stays on classic /files and loops with DiffSeek /changes redirect.',
      );
    }
    let raw: unknown;
    try {
      raw = await loadStorageState(storageStateSource);
    } catch (error) {
      throw new Error(
        `Failed to load DIFFSEEK_GITHUB_STORAGE_STATE: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    cookies = parseStorageCookies(raw);
  });

  test.afterAll(async () => {
    await activeContext?.close();
    if (githubChurn.cold.control.length === 0) return;
    const report = {
      prUrl: livePrUrl,
      samples,
      ...loads,
      medians: Object.fromEntries(
        livePerfScenarios.map((scenario) => [scenario, medianSample(loads[scenario])]),
      ),
      phases,
      githubChurn,
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

  test('measures GitHub alone on the same loads and mark', async () => {
    // DiffSeek clears viewed files once; GitHub-only samples then keep them clear.
    await startCleanContext();
    for (let index = 0; index < samples; index += 1) {
      const context = await startCleanContext(false);
      const page = await context.newPage();
      await measureGithub(page, 'cold', () => page.goto(livePrUrl, { waitUntil: 'domcontentloaded' }));
      const viewedButton = (name: string) =>
        page.locator('[data-diff-header-wrapper="true"]').getByRole('button', { name, exact: true }).first();
      await measureGithub(page, 'mark-viewed', () => viewedButton('Not Viewed').click({ timeout: stepTimeout }), '1');
      await viewedButton('Viewed').click({ timeout: stepTimeout });
      await untilNoViewedFiles(page, 'after the GitHub-only unmark');
      await measureGithub(page, 'warm', () => page.reload({ waitUntil: 'domcontentloaded' }));
      await showConversation(page);
      await measureGithub(page, 'hot', () => showFiles(page));
      await showPullList(page);
      await measureGithub(page, 'restored', () => openPullFromList(page));
      await page.close();
      // Without auto-view, a cold-mark load is another cold load.
      const marking = await context.newPage();
      await measureGithub(marking, 'coldMark', () => marking.goto(livePrUrl, { waitUntil: 'domcontentloaded' }));
      await marking.close();
    }
    expect(githubChurn.coldMark.control).toHaveLength(samples);
  });

  test('measures cold, warm, hot, restored, cold-mark, and unmark reviews', async () => {
    for (let index = 0; index < samples; index += 1) {
      const context = await startCleanContext();
      await clearExtensionStore(context);
      await writeShownDefaults(context);
      const page = await context.newPage();
      const coldSample = await measureReview(page, 'cold', async () => {
        await page.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
      });
      loads.cold.push(coldSample);
      expect(rebuildFailures(coldSample, budgets)).toEqual([]);
      await untilNoViewedFiles(page, `before sample ${index + 1} actions`);
      phases.push(
        { sample: index, phase: 'toggle-filter', ...(await runToggle(page)) },
        { sample: index, phase: 'mark-viewed', ...(await runMark(page)) },
      );

      const warmSample = await measureReview(page, 'warm', async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
      });
      loads.warm.push(warmSample);
      expect(rebuildFailures(warmSample, budgets)).toEqual([]);

      await showConversation(page);
      const hotSample = await measureReview(page, 'hot', () => showFiles(page));
      loads.hot.push(hotSample);
      expect(hotLossFailures(hotSample)).toEqual([]);

      const filtered = await excludeFirstValues(page);
      await showPullList(page);
      const restoredSample = await measureReview(page, 'restored', () => openPullFromList(page), filtered.hidden);
      loads.restored.push(restoredSample);
      expect(rebuildFailures(restoredSample, budgets)).toEqual([]);
      expect(hotLossFailures(restoredSample)).toEqual([]);
      expect(await reviewState(page)).toEqual(filtered);
      // Auto-view is still off here, so this leaves every file unviewed.
      await clearViewedFiles(page);
      await page.close();

      // No saved defaults is a fresh install: auto-view marks generated files viewed.
      await clearExtensionStore(context);
      const marking = await context.newPage();
      const coldMarkSample = await measureReview(marking, 'coldMark', async () => {
        await marking.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
      });
      loads.coldMark.push(coldMarkSample);
      expect(rebuildFailures(coldMarkSample, budgets)).toEqual([]);
      const unmarkSample = await measureUnmark(marking);
      loads.unmark.push(unmarkSample);
      expect(rebuildFailures(unmarkSample, budgets)).toEqual([]);
      await untilNoViewedFiles(marking, 'after generated unmark');
      await marking.close();
    }

    for (const phase of phases) {
      expect(actionFailures(phase.phase, phase, budgets)).toEqual([]);
    }
    for (const scenario of livePerfScenarios) {
      expect(medianBudgetFailures(loads[scenario], budgets)).toEqual([]);
    }
    for (const step of liveSteps) {
      expect(githubChurnFailures(step, githubChurn[step], budgets)).toEqual([]);
    }
  });

  test('hide defaults hide generated and viewed files until shown', async () => {
    const context = activeContext ?? await startCleanContext();
    await clearExtensionStore(context);
    await writeDefaults(context, hideDefaults);
    const page = await context.newPage();
    await page.goto(livePrUrl, { waitUntil: 'domcontentloaded' });
    await openFilterMenu(page, panelsTimeout);
    const viewed = page.locator(viewedToggle);
    const generated = page.locator(generatedToggle);
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

/** `hidden` is the tree rows a restored load must hide again before it is complete. */
async function measureReview(
  page: Page,
  scenario: LivePerfScenario,
  navigate: () => Promise<void>,
  hidden: string[] = [],
): Promise<LivePerfSample> {
  const requests = emptyGithubRequestCounts();
  // Metadata fetches run in the extension service worker, so the page misses them.
  const onRequest = (request: Request) => {
    noteGithubRequest(requests, request.url());
  };
  const browserContext = page.context();
  browserContext.on('request', onRequest);
  try {
    const restored = scenario === 'restored';
    if (restored) await resetReconcileWrites(page);
    await resetChurn(page);
    const started = Date.now();
    await navigate();
    await untilDom(page, { kind: 'present', selector: '[data-diffseek-viewed-action]' }, panelsTimeout, 'first DiffSeek control');
    const firstRenderSeconds = await renderSeconds(page, started);
    // GitHub removes and restores panels on these navigations. Row loss starts
    // at the first control. Restored reconciles and DOM writes start earlier,
    // so the badge insert on that navigation is kept.
    const inPage = scenario === 'hot' || restored;
    if (scenario === 'hot') await resetRedraws(page);
    if (restored) await resetRedrawRows(page);
    const menuOpenSeconds = await openFilterMenu(page);
    await untilDom(
      page,
      { kind: 'text', selector: generatedCounter, pattern: generatedCategorizedPattern(expectedGeneratedTotal).source },
      panelsTimeout,
      'generated counter categorized',
    );
    if (scenario === 'coldMark') {
      // The counter covers loaded files only; this notice waits for streamed ones too.
      await untilDom(page, { kind: 'text', selector: snackbar, pattern: '^Auto-view: generated files marked viewed$' }, 300_000, 'auto-view done');
      await untilGenerated(page, 'true');
    }
    if (scenario === 'restored') {
      await untilDom(page, { kind: 'tree-hidden', ids: hidden }, panelsTimeout, 'the same files hidden again');
    }
    const panelsSeconds = secondsBetween(started);
    if (inPage) {
      // Wait for every removed row to return (event), not a fixed delay. The
      // trace still timestamps returns: one back after 500 ms is a net loss.
      // A row that never returns trips the guard and is then counted as lost.
      await untilDom(page, { kind: 'trace-settled' }, stepTimeout, 'hot rows returned').catch(() => undefined);
      await page.evaluate(() => {
        document.dispatchEvent(new Event('diffseek-redraw-settle'));
      });
    }
    await recordChurn(page, scenario, 'extension');
    return recordSample({
      scenario,
      firstRenderSeconds,
      menuOpenSeconds,
      panelsSeconds,
      requests,
      ...(await readRedraws(page)),
    });
  } finally {
    browserContext.off('request', onRequest);
  }
}

/** From cold-mark's open menu: the generated count unmarks every generated file. */
async function measureUnmark(page: Page): Promise<LivePerfSample> {
  const requests = emptyGithubRequestCounts();
  const onRequest = (request: Request) => {
    noteGithubRequest(requests, request.url());
  };
  const browserContext = page.context();
  browserContext.on('request', onRequest);
  try {
    await resetRedraws(page);
    const menuOpenSeconds = await openFilterMenu(page);
    const before = await readRedraws(page);
    await resetChurn(page);
    const started = Date.now();
    await page.locator(generatedCounter).click({ timeout: stepTimeout });
    // The first pass after the click redraws GitHub's first unmarked file.
    await untilDom(page, { kind: 'dataset-above', key: 'diffseekReconciles', value: before.reconciles }, panelsTimeout, 'first unmark reconcile');
    const firstRenderSeconds = secondsBetween(started);
    await untilGenerated(page, 'false');
    await recordChurn(page, 'unmark', 'extension');
    return recordSample({
      scenario: 'unmark',
      firstRenderSeconds,
      menuOpenSeconds,
      panelsSeconds: secondsBetween(started),
      requests,
      ...(await readRedraws(page)),
    });
  } finally {
    browserContext.off('request', onRequest);
  }
}

/** From `navigate` until GitHub's own viewed count is back on the files view, with `viewed` files. */
async function measureGithub(
  page: Page,
  step: LiveStep,
  navigate: () => Promise<unknown>,
  viewed = '\\d+',
): Promise<void> {
  await resetChurn(page);
  await navigate();
  await page.waitForURL(/\/changes(\?|$)/, { timeout: stepTimeout });
  await untilDom(page, { kind: 'text', selector: viewedProgress, pattern: `^${viewed}${viewedProgressTotal}` }, panelsTimeout, `GitHub-only ${step}`);
  await recordChurn(page, step, 'control');
}

async function recordChurn(page: Page, step: LiveStep, run: keyof ChurnSamples): Promise<void> {
  const churn = await readChurn(page);
  githubChurn[step][run].push(churn);
  console.log(`diffseek live-churn:${step}:${run}`, churn);
}

function recordSample(sample: LivePerfSample): LivePerfSample {
  test.info().annotations.push({
    type: `live-perf:${sample.scenario}`,
    description: JSON.stringify(sample),
  });
  console.log(`diffseek live-perf:${sample.scenario}`, sample);
  return sample;
}

/** Every generated file has its viewed state, and no auto-view batch is running. */
async function untilGenerated(page: Page, viewed: 'true' | 'false'): Promise<void> {
  await untilDom(page, { kind: 'attr', selector: generatedCounter, name: 'aria-pressed', value: viewed }, 300_000, `generated files viewed=${viewed}`);
  await untilDom(page, { kind: 'absent', selector: `${generatedToggle}:disabled` }, 300_000, 'generated row enabled');
}

/**
 * Excludes the first owner, group, and format, then returns the filtered
 * state. Viewed files are shown again: GitHub's viewed state can differ after
 * the pull reloads, and the tree must depend on the filters alone.
 */
async function excludeFirstValues(page: Page): Promise<ReviewState> {
  await openFilterMenu(page);
  const toggles = ['owners', 'groups', 'languages'].map((facet) => `[data-filter-kind="${facet}"]`);
  // The viewed row cycles shown (true), hidden now (false), and always hidden (mixed).
  const viewed = await page.locator(viewedToggle).getAttribute('aria-checked');
  const viewedClicks = viewed === 'false' ? 2 : Number(viewed === 'mixed');
  for (let click = 0; click < viewedClicks; click += 1) toggles.push(viewedToggle);
  for (const toggle of toggles) {
    const before = await readRedraws(page);
    await page.locator(toggle).first().click({ timeout: stepTimeout });
    await untilDom(page, { kind: 'dataset-above', key: 'diffseekReconciles', value: before.reconciles }, stepTimeout, `${toggle} reconcile`);
  }
  await untilDom(page, { kind: 'attr', selector: viewedToggle, name: 'aria-checked', value: 'true' }, stepTimeout, 'viewed files shown');
  await untilDom(page, { kind: 'tree-hidden' }, panelsTimeout, 'every filtered file hidden in the tree');
  return reviewState(page);
}

type ReviewState = { menu: string[]; tree: string[]; hidden: string[] };

/** Every menu row's choice, every tree row's visibility and expansion, and the hidden files. */
async function reviewState(page: Page): Promise<ReviewState> {
  await openFilterMenu(page);
  return page.evaluate(() => ({
    menu: [...document.querySelectorAll('[data-diffseek="filters"] [data-filter-kind]')].map((item) =>
      ['data-filter-kind', 'data-filter-value', 'aria-checked'].map((name) => item.getAttribute(name)).join(':'),
    ),
    tree: [...document.querySelectorAll<HTMLElement>('[role="tree"][aria-label="File Tree"] [role="treeitem"]')].map(
      (item) => [item.id, item.dataset.diffseekFilteredOut === 'true' ? 'hidden' : 'shown', item.getAttribute('aria-expanded')].join(':'),
    ),
    hidden: [
      ...document.querySelectorAll<HTMLElement>('[role="tree"][aria-label="File Tree"] [role="treeitem"]:not([aria-expanded])'),
    ]
      .filter((item) => item.dataset.diffseekFilteredOut === 'true')
      .map((item) => item.id),
  }));
}

async function runToggle(page: Page): Promise<RedrawCounts> {
  await closeFilterMenu(page);
  await resetRedraws(page);
  await openFilterMenu(page);
  const before = await readRedraws(page);
  await resetChurn(page);
  await page.locator(viewedToggle).click({ timeout: stepTimeout });
  await untilDom(page, { kind: 'dataset-above', key: 'diffseekReconciles', value: before.reconciles }, stepTimeout, 'toggle reconcile');
  await recordChurn(page, 'toggle-filter', 'extension');
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
  await resetChurn(page);
  await target.click({ timeout: stepTimeout });
  await untilAttribute(target, 'aria-pressed', 'true', stepTimeout, 'file marked viewed');
  await recordChurn(page, 'mark-viewed', 'extension');
  await action.dispose();
  return subtractCounts(await readRedraws(page), before);
}

async function showConversation(page: Page): Promise<void> {
  // GitHub now labels this tab Overview; older pages say Conversation.
  const tab = /^(Overview|Conversation)/;
  const conversation = page.getByRole('link', { name: tab });
  await untilDom(page, { kind: 'link-text', pattern: tab.source }, stepTimeout, `Overview link missing at ${page.url()}`);
  await conversation.first().click({ timeout: stepTimeout });
  await page.waitForURL(/\/pull\/\d+(?:[?#].*)?$/, { timeout: stepTimeout });
  await untilDom(page, { kind: 'absent', selector: filesViewMarks }, stepTimeout, 'files view gone');
}

async function showPullList(page: Page): Promise<void> {
  await closeFilterMenu(page);
  const pulls = new URL(livePrUrl).pathname.replace(/\/pull\/\d+\/changes$/, '/pulls');
  await page.locator(`a[href="${pulls}"]`).first().click({ timeout: stepTimeout });
  await page.waitForURL(/\/pulls(?:[?#].*)?$/, { timeout: stepTimeout });
  await untilDom(page, { kind: 'absent', selector: filesViewMarks }, stepTimeout, 'files view gone');
}

/** A click in the list, so the browser cannot restore the page from history. */
async function openPullFromList(page: Page): Promise<void> {
  const pull = new URL(livePrUrl).pathname.replace(/\/changes$/, '');
  await page.locator(`a[href$="${pull}"]`).first().click({ timeout: stepTimeout });
  await page.waitForURL(/\/pull\/\d+(?:[?#].*)?$/, { timeout: stepTimeout });
  await showFiles(page);
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

async function resetReconcileWrites(page: Page): Promise<void> {
  await resetRedraws(page);
}

async function resetRedrawRows(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('diffseek-redraw-rows-reset'));
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

async function clearViewedFiles(page: Page, retries = 1): Promise<void> {
  const progress = await untilDom(
    page,
    { kind: 'text', selector: viewedProgress, pattern: `^\\d+${viewedProgressTotal}` },
    panelsTimeout,
    'Viewed-state reset needs GitHub’s PR-wide viewed count',
  );
  const viewed = Number(progress.split(' ', 1)[0]);
  if (viewed === 0) return;

  await openFilterMenu(page, panelsTimeout);
  // The denominator includes filtered files. Wait for streamed viewed files too.
  await untilDom(
    page,
    { kind: 'text', selector: unmarkViewedCounter, pattern: `^\\d+/${viewed}$` },
    panelsTimeout,
    `Viewed-state reset needs Unmark all for every viewed file (${progress})`,
  );
  await page.locator(unmarkViewedCounter).click({ timeout: stepTimeout });
  const success = 'All files in category unmarked';
  const outcome = await untilDom(
    page,
    { kind: 'text', selector: snackbar, pattern: `^(${success}|Couldn't unmark files\\. Try again\\.)$` },
    300_000,
    'Viewed-state reset needs the unmark result',
  );
  if (outcome !== success) throw new Error(`Viewed-state reset failed: ${outcome}`);

  await untilNoViewedFiles(page, 'after Unmark all');
  await page.reload({ waitUntil: 'domcontentloaded' });
  // GitHub has shown viewed files again after a reload; unmark them once more.
  if (retries > 0) return clearViewedFiles(page, retries - 1);
  await untilNoViewedFiles(page, 'after reload');
}

async function untilNoViewedFiles(page: Page, phase: string): Promise<void> {
  await untilDom(
    page,
    { kind: 'text', selector: viewedProgress, pattern: `^0${viewedProgressTotal}` },
    panelsTimeout,
    `Viewed-state reset expected zero viewed files ${phase}`,
  );
}
