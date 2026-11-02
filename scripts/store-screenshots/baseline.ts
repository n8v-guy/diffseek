import type { Page } from '@playwright/test';

import { baseline, totalFiles } from './config.ts';
import {
  closeMenu,
  expectCounter,
  hasCounter,
  openMenu,
  settleCounts,
  showAllSections,
  showFacet,
  waitForToasts,
} from './page.ts';
import { openReview, withPage } from './session.ts';
import { collectFileIds, collectFileStates, setFileViewed } from './tree.ts';

const clearAllSelector =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="viewed"][data-viewed-value="true"]';

/** BASELINE=1: restore the demo PR, then prove it, without taking shots. */
export async function restoreAndVerify(): Promise<void> {
  await withPage(async (page) => {
    await restoreBaseline(page);
    await verifyBaseline(page);
  });
}

/** Puts the demo PR back to exactly the baseline files viewed. */
export async function restoreBaseline(page: Page, attempt = 1): Promise<void> {
  if (page.isClosed()) return;
  await openMenuIfPresent(page);
  await releaseAutoView(page);
  await showFacet(page, 'viewed');
  await showFacet(page, 'generated');
  await showAllSections(page);
  await clearViewedMarks(page);
  await closeMenu(page);
  await markBaseline(page);
  await waitForToasts(page);
  await expectCounter(page, baseline.length);
  await confirmBaseline(page, attempt);
}

async function clearViewedMarks(page: Page): Promise<void> {
  // A menu row marks its whole category, so one click on the Viewed row
  // clears every viewed file before the baseline files go back on.
  const clearAll = page.locator(clearAllSelector);
  if (
    (await clearAll.count()) === 0
    || (await clearAll.getAttribute('aria-label')) !== 'Unmark all'
  ) return;
  await clearAll.click();
  await waitForToasts(page);
  await hasCounter(page, 0);
}

async function confirmBaseline(page: Page, attempt: number): Promise<void> {
  // GitHub saves viewed marks in the background. Reload to prove they stuck
  // before the browser closes, and go again if the server still disagrees.
  await page.waitForTimeout(5_000);
  await openReview(page);
  if (await hasCounter(page, baseline.length)) {
    console.log(`Baseline restored: ${baseline.length}/${totalFiles} viewed.`);
    return;
  }
  if (attempt >= 3) throw new Error('Baseline did not stick after 3 tries');
  console.log('Baseline did not stick, restoring again.');
  await restoreBaseline(page, attempt + 1);
}

async function markBaseline(page: Page): Promise<void> {
  const ids = await collectFileIds(page);
  const missing = baseline.filter((filePath) => !ids.includes(filePath));
  if (missing.length > 0) {
    throw new Error(`Baseline files not in the tree: ${missing.join(', ')}`);
  }
  for (const id of baseline) await setFileViewed(page, id, true);
}

async function openMenuIfPresent(page: Page): Promise<void> {
  try {
    await openMenu(page);
  } catch {
    // Restoration continues when the menu cannot open.
  }
}

async function releaseAutoView(page: Page): Promise<void> {
  const pill = page.locator('[data-diffseek-always-read]');
  if (
    (await pill.count()) === 0
    || (await pill.getAttribute('aria-pressed')) !== 'true'
  ) return;
  await pill.click();
  await waitForToasts(page);
}

/** Fails unless exactly the baseline files are viewed, file by file. */
async function verifyBaseline(page: Page): Promise<void> {
  await openReview(page);
  // The circles follow GitHub's streamed file list; wait for complete counts.
  await settleCounts(page, baseline.length);
  await closeMenu(page);
  const states = await collectFileStates(page);
  const viewed = [...states].filter(([, pressed]) => pressed === 'true').map(([id]) => id);
  const extra = viewed.filter((id) => !baseline.includes(id));
  const missing = baseline.filter((id) => !viewed.includes(id));
  const counted = await hasCounter(page, baseline.length);
  const report = { counted, extra, files: states.size, missing, viewed: viewed.length };
  console.log('baseline check:', JSON.stringify(report));
  if (states.size !== totalFiles || extra.length > 0 || missing.length > 0 || !counted) {
    throw new Error(`The demo PR is not at its ${baseline.length}/${totalFiles} baseline: ${JSON.stringify(report)}`);
  }
}
