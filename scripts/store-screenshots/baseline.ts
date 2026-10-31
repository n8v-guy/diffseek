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

/** Puts the demo PR back to exactly the baseline files viewed. */
export async function restoreBaseline(page: Page, attempt = 1): Promise<void> {
  if (page.isClosed()) return;
  await openMenu(page).catch(() => undefined);
  const pill = page.locator('[data-diffseek-always-read]');
  if ((await pill.count()) > 0 && (await pill.getAttribute('aria-pressed')) === 'true') {
    await pill.click();
    await waitForToasts(page);
  }
  await showFacet(page, 'viewed');
  await showFacet(page, 'generated');
  await showAllSections(page);
  // A menu row marks its whole category, so one click on the Viewed row
  // clears every viewed file before the baseline files go back on.
  const clearAll = page.locator(clearAllSelector);
  if ((await clearAll.count()) > 0 && (await clearAll.getAttribute('aria-label')) === 'Mark as not viewed') {
    await clearAll.click({ force: true });
    await waitForToasts(page);
    await hasCounter(page, 0);
  }
  await closeMenu(page);
  const ids = await collectFileIds(page);
  const missing = baseline.filter((path) => !ids.includes(path));
  if (missing.length > 0) {
    throw new Error(`Baseline files not in the tree: ${missing.join(', ')}`);
  }
  for (const id of baseline) {
    await setFileViewed(page, id, true);
  }
  await waitForToasts(page);
  await expectCounter(page, baseline.length);
  // GitHub saves viewed marks in the background. Reload to prove they stuck
  // before the browser closes, and go again if the server still disagrees.
  await page.waitForTimeout(5_000);
  await openReview(page);
  if (!(await hasCounter(page, baseline.length))) {
    if (attempt >= 3) throw new Error('Baseline did not stick after 3 tries');
    console.log('Baseline did not stick, restoring again.');
    await restoreBaseline(page, attempt + 1);
    return;
  }
  console.log(`Baseline restored: ${baseline.length}/${totalFiles} viewed.`);
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
  const report = { files: states.size, viewed: viewed.length, counted, extra, missing };
  console.log('baseline check:', JSON.stringify(report));
  if (states.size !== totalFiles || extra.length > 0 || missing.length > 0 || !counted) {
    throw new Error(`The demo PR is not at its ${baseline.length}/${totalFiles} baseline: ${JSON.stringify(report)}`);
  }
}

/** BASELINE=1: restore the demo PR, then prove it, without taking shots. */
export async function restoreAndVerify(): Promise<void> {
  await withPage(async (page) => {
    await restoreBaseline(page);
    await verifyBaseline(page);
  });
}
