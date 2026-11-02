import { expect, type Page } from '@playwright/test';

import { type RedrawCounts, secondsBetween } from './live-perf.helpers';
import { tagFilterButton, untilAttribute, untilDom } from './live-wait';

const viewedFacetAction =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="viewed"][data-viewed-value="true"]';
const filterMenu = '[data-diffseek="filters"]';
const viewedAction = '[data-diffseek-viewed-action]';
const filterMenuAttempts = 3;
const unviewedAction = `${viewedAction}[aria-pressed="false"]`;
export const viewedToggle = '[data-filter-kind="viewed"][data-filter-value="true"]';
export const stepTimeout = 20_000;
export const panelsTimeout = 90_000;

export async function assertAuthenticatedReview(page: Page): Promise<void> {
  await expect(
    page.getByRole('link', { exact: true, name: 'Sign in' }),
    'GitHub session from DIFFSEEK_GITHUB_STORAGE_STATE is not authenticated',
  ).toHaveCount(0);
  await page.waitForURL(/\/changes(\?|$)/v, { timeout: stepTimeout });
  await untilFirstControl(page);
}

export async function clearViewedFiles(page: Page): Promise<void> {
  await openFilterMenu(page);
  const action = page.locator(viewedFacetAction);
  if ((await action.count()) === 0) return;
  const label = await action.getAttribute('aria-label', { timeout: 5_000 });
  if (label !== 'Unmark all') return;
  await action.click();
  await untilDom(
    page,
    { kind: 'text', pattern: "^(All files in category unmarked|Couldn't unmark files\\. Try again\\.)$", selector: '[data-diffseek="snackbar"]' },
    { message: 'not-viewed snackbar', ms: 300_000 },
  );
}

export async function openFilterMenu(page: Page, guardMs = stepTimeout): Promise<number> {
  const filters = page.locator(filterMenu);
  if ((await filters.count()) > 0) return 0;
  // GitHub server-renders this button and later swaps in a client-rendered
  // copy; clicks on the server copy do nothing. Wait for the interactive copy.
  await untilDom(page, { kind: 'filter-button-ready' }, { message: 'Filter options button interactive', ms: guardMs });
  const button = page.getByRole('button', { name: 'Filter options' });
  for (let attempt = 0; attempt < filterMenuAttempts; attempt += 1) {
    await dismissCompactLinePopover(page);
    await tagFilterButton(page);
    const started = Date.now();
    await button.click({ timeout: stepTimeout });
    // Re-click only on an event: GitHub replaced the button under the click.
    const outcome = await untilDom(page, { kind: 'filter-menu-or-replaced' }, { message: 'Filter menu did not open', ms: stepTimeout });
    if (outcome === 'open') return secondsBetween(started);
  }
  throw new Error('Filter options button kept being replaced');
}

export async function readRedraws(page: Page): Promise<RedrawCounts> {
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

export async function renderSeconds(page: Page, started: number): Promise<number> {
  const raw = await page.locator('html').getAttribute('data-diffseek-first-render-epoch');
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch >= started) {
    return secondsBetween(started, epoch);
  }
  return secondsBetween(started);
}

export async function resetRedraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = globalThis;
    host.document.dispatchEvent(new host.Event('diffseek-redraw-reset'));
  });
}

export async function runMark(page: Page): Promise<RedrawCounts> {
  await resetRedraws(page);
  const before = await readRedraws(page);
  // Folders are treeitems too and contain their files' links. aria-expanded
  // is the folder control; the action must be this row's own icon, not a
  // descendant file, or the id selector matches every row in the folder.
  const row = page
    .locator('[role="treeitem"]:not([aria-expanded])')
    .filter({
      has: page.locator(unviewedAction),
    })
    .first();
  await untilDom(page, { kind: 'unviewed-file-row' }, { message: 'unviewed file row', ms: stepTimeout });
  const action = await row.evaluateHandle((element, selector) => {
    return (
      [...element.querySelectorAll<HTMLElement>(selector)].find(
        (node) => node.closest('[role="treeitem"]') === element,
      ) ?? null
    );
  }, unviewedAction);
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

export async function runToggle(page: Page): Promise<RedrawCounts> {
  await closeFilterMenu(page);
  await resetRedraws(page);
  await openFilterMenu(page);
  const before = await readRedraws(page);
  await page.locator(viewedToggle).click({ timeout: stepTimeout });
  await untilDom(page, { key: 'diffseekReconciles', kind: 'dataset-above', value: before.reconciles }, { message: 'toggle reconcile', ms: stepTimeout });
  return subtractCounts(await readRedraws(page), before);
}

export async function showConversation(page: Page): Promise<void> {
  const conversation = page.getByRole('link', { name: /^Conversation/v });
  await untilDom(page, { kind: 'link-prefix', prefix: 'Conversation' }, { message: `Conversation link missing at ${page.url()}`, ms: stepTimeout });
  await conversation.first().click({ timeout: stepTimeout });
  await page.waitForURL(/\/pull\/\d+(?:[?#].*)?$/v, { timeout: stepTimeout });
  await untilDom(page, { kind: 'absent', selector: viewedAction }, { message: 'DiffSeek controls gone', ms: stepTimeout });
}

export async function showFiles(page: Page): Promise<void> {
  await untilDom(page, { kind: 'present', selector: '#prs-files-anchor-tab, a[href*="/changes"], a[href$="/files"]' }, { message: `Files changed link missing at ${page.url()}`, ms: stepTimeout });
  const anchored = page.locator('#prs-files-anchor-tab');
  const files =
    (await anchored.count()) > 0
      ? anchored.first()
      : page.getByRole('link', { name: 'Files changed' }).first();
  await files.click({ timeout: stepTimeout });
}

export async function untilFirstControl(page: Page): Promise<void> {
  await untilDom(page, { kind: 'present', selector: viewedAction }, { message: 'first DiffSeek control', ms: panelsTimeout });
}

async function closeFilterMenu(page: Page): Promise<void> {
  if ((await page.locator(filterMenu).count()) === 0) return;
  await page.keyboard.press('Escape');
  await untilDom(page, { kind: 'absent', selector: filterMenu }, { message: 'filter menu closed', ms: stepTimeout });
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
