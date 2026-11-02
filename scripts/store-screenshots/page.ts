import type { Locator, Page } from '@playwright/test';

import { menuSelector, snackbarSelector, totalFiles } from './config.ts';

export async function openMenu(page: Page): Promise<void> {
  if ((await page.locator(menuSelector).count()) > 0) return;
  await page.getByRole('button', { name: 'Filter options' }).click();
  await page.locator(menuSelector).waitFor({ timeout: 30_000 });
}

export async function closeMenu(page: Page): Promise<void> {
  if ((await page.locator(menuSelector).count()) === 0) return;
  await page.keyboard.press('Escape');
  await page.locator(menuSelector).waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
}

/** Wait for a toast to come and go; return early when none comes. */
export async function waitForToasts(page: Page): Promise<void> {
  const snacks = page.locator(snackbarSelector);
  const started = Date.now();
  let saw = false;
  while (Date.now() - started < 20_000) {
    const count = await snacks.count();
    if (count > 0) saw = true;
    if (saw && count === 0) return;
    if (!saw && Date.now() - started > 1_200) return;
    await page.waitForTimeout(200);
  }
  throw new Error('DiffSeek toasts did not clear');
}

/** Wait until no snackbar has been up for two seconds. */
export async function waitForQuiet(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if ((await page.locator(snackbarSelector).count()) > 0) quietSince = Date.now();
    else if (Date.now() - quietSince > 2_000) return;
    await page.waitForTimeout(200);
  }
  throw new Error('DiffSeek toasts did not clear');
}

export async function expectNoToast(page: Page): Promise<void> {
  if ((await page.locator(snackbarSelector).count()) > 0) throw new Error('A toast is on screen');
}

/** Drop the mouse and focus, so nothing looks hovered. */
export async function restPointer(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.waitForTimeout(300);
}

/** GitHub's own "N / 82 viewed" counter. */
async function counter(page: Page, count: number): Promise<Locator> {
  const source = new RegExp(`\\b${count}\\s*/\\s*${totalFiles}\\b`);
  const matches = page.getByText(source);
  const found = await matches.count();
  for (let index = 0; index < found; index += 1) {
    const item = matches.nth(index);
    const text = await item.innerText().catch(() => '');
    if (/viewed/i.test(text) && (await item.isVisible())) return item;
  }
  throw new Error(`Could not find ${count} / ${totalFiles} viewed`);
}

export async function hasCounter(page: Page, count: number): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await counter(page, count).then(() => true, () => false)) return true;
    await page.waitForTimeout(1_000);
  }
  return false;
}

export async function expectCounter(page: Page, count: number): Promise<void> {
  if (!(await hasCounter(page, count))) await counter(page, count);
}

/** GitHub streams the file list in; wait until the menu badges stop changing. */
export async function settleCounts(page: Page, viewed = 12): Promise<void> {
  await openMenu(page);
  await page.locator('[data-filter-kind="generated"]').waitFor({ timeout: 60_000 });
  let last = '';
  let steady = 0;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && steady < 6) {
    const text = await page.evaluate(
      (selector) => [...document.querySelectorAll(`${selector} .diffseek-menu-count`)].map((node) => node.textContent).join(' '),
      menuSelector,
    );
    const complete = /\/46\b/.test(text) && new RegExp(`/${viewed}\\b`).test(text);
    steady = text === last && complete ? steady + 1 : 0;
    last = text;
    await page.waitForTimeout(500);
  }
  if (steady < 6) throw new Error(`Menu counts never settled: ${last}`);
}

export async function showAllSections(page: Page): Promise<void> {
  await openMenu(page);
  const all = `${menuSelector} [data-filter-all]`;
  const count = await page.locator(all).count();
  for (let index = 0; index < count; index += 1) {
    await openMenu(page);
    await page.evaluate(({ selector, at }) => {
      const actions = document.querySelectorAll<HTMLElement>(selector);
      actions[at]?.click();
    }, { selector: all, at: index });
    await page.waitForTimeout(400);
  }
  await waitForToasts(page);
}

export async function showFacet(page: Page, kind: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openMenu(page);
    const row = facetToggle(page, kind);
    await row.waitFor({ timeout: 30_000 });
    if ((await row.getAttribute('aria-checked')) === 'true') return;
    await row.click();
    await waitForToasts(page);
  }
  throw new Error(`Could not show ${kind} files`);
}

export function facetToggle(page: Page, kind: string): Locator {
  return page.locator(`[data-filter-kind="${kind}"][data-filter-value="true"]`);
}

function menuRow(page: Page, kind: string, value: string): Locator {
  return page.locator(`.diffseek-menu-row:has([data-filter-kind="${kind}"][data-filter-value="${value}"])`);
}

export function webRow(page: Page): Locator {
  return menuRow(page, 'owners', '@acme/web-platform');
}

export async function paymentsRow(page: Page): Promise<Locator> {
  const exact = menuRow(page, 'owners', '@acme/payments');
  if ((await exact.count()) > 0) return exact.first();
  const fallback = page.locator('.diffseek-menu-row', { hasText: 'payments' }).first();
  if ((await fallback.count()) === 0) throw new Error('Owners row for payments was not found');
  return fallback;
}

export function filesTab(page: Page): Locator {
  const anchored = page.locator('#prs-files-anchor-tab');
  return anchored.or(page.getByRole('link', { name: /Files changed/ })).first();
}

/** Hover only: the shots carry no drawn cursor, hover state shows the target. */
export async function cursorOn(page: Page, locator: Locator): Promise<void> {
  const point = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(200);
}
