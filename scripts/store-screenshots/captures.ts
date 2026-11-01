import type { Page } from '@playwright/test';

import {
  clipHeight,
  clipWidth,
  menuSelector,
  outHeight,
  type Box,
  type Clip,
  type Shot,
} from './config.ts';
import {
  discOf,
  frame,
  fullWidthClip,
  halfCrop,
  outBox,
  settleLayout,
  shoot,
} from './geometry.ts';
import {
  closeMenu,
  cursorOn,
  expectCounter,
  expectNoToast,
  facetToggle,
  filesTab,
  openMenu,
  paymentsRow,
  restPointer,
  settleCounts,
  waitForQuiet,
  waitForToasts,
  webRow,
} from './page.ts';
import { expandTo, ownAction, treeRow } from './tree.ts';

const pressed = 'aria-pressed';

export type NoiseCutCapture = { shot: Shot; signs: Box; pillBox: Box; menuBox: Box };
export type OnlySplitCapture = {
  beforeShot: Shot;
  afterShot: Shot;
  beforeCrop: number;
  afterCrop: number;
  onlyBox: Box;
  allBox: Box;
  resetBox: Box;
};
export type ViewedBadgesCapture = { shot: Shot; boxes: Record<'folder' | 'circle' | 'menu' | 'tree', Box> };

/** Framed like shot 3: the full width at a lower zoom, from the tab bar down. */
async function tabBarClip(page: Page): Promise<Clip> {
  await filesTab(page).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settleLayout(page);
  return fullWidthClip(page, 1.2, outHeight);
}

export async function noiseCut(page: Page): Promise<NoiseCutCapture> {
  // The real first run: Viewed and Generated hidden, auto-view on, so the
  // generated files are marked viewed as soon as the PR loads.
  await settleCounts(page, 58);
  await expectCounter(page, 58);
  await waitForQuiet(page);
  const row = page.locator('.diffseek-menu-row:has([data-filter-kind="generated"])');
  const pill = row.locator('[data-diffseek-always-read]');
  if ((await pill.getAttribute(pressed)) !== 'true') throw new Error('auto-view is not on for a fresh install');
  // The file tree, the counter and the open menu all show.
  const clip = await tabBarClip(page);
  await restPointer(page);
  await waitForQuiet(page);
  await expectNoToast(page);
  const signs = await signBox(page, ['viewed', 'generated'], clip);
  const pillBox = await outBox(pill, clip, 0, 0);
  const menuBox = await outBox(page.locator(menuSelector), clip, 0, 0);
  const shot = await shoot(page, clip);
  return { shot, signs, pillBox, menuBox };
}

/** Output box around the "−" / "✓" signs (a ::before) on the given facet rows. */
async function signBox(page: Page, kinds: string[], clip: Clip): Promise<Box> {
  await page.evaluate(() => document.fonts.ready);
  const boxes: Box[] = [];
  for (const kind of kinds) {
    const box = await facetToggle(page, kind).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.querySelector('span')?.getBoundingClientRect() ?? rect;
      const sign = getComputedStyle(element, '::before');
      const left = rect.left + (Number.parseFloat(getComputedStyle(element).paddingLeft) || 0);
      // The sign's box is wider than the glyph and left-aligned, so measure
      // the glyph's own ink in the sign's font.
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('No 2D canvas');
      context.font = sign.font;
      const ink = context.measureText(sign.content.replace(/^["']|["']$/g, ''));
      return { x: left - ink.actualBoundingBoxLeft, y: label.top, width: ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight, height: label.height };
    });
    boxes.push(await outBox(box, clip, 0, 0));
  }
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  };
}

/** Before and after "only" on the payments owner, at the 12/82 baseline. */
export async function onlySplit(page: Page): Promise<OnlySplitCapture> {
  await settleCounts(page);
  const row = await paymentsRow(page);
  const only = row.locator('.diffseek-menu-only');
  const menu = page.locator(menuSelector);
  const button = page.getByRole('button', { name: 'Filter options' }).filter({ visible: true }).first();
  // Frame from the filter button down, so GitHub's "N / 82 viewed" stays out.
  const subjects = [button, menu.locator('[data-filter-kind="generated"]'), webRow(page)];
  const beforeClip = await frame(page, subjects, clipWidth, clipHeight, 4);
  await row.hover();
  await cursorOn(page, only);
  const beforeCrop = halfCrop(await menu.boundingBox(), beforeClip);
  const onlyBox = await outBox(only, beforeClip, beforeCrop, 0);
  const beforeShot = await shoot(page, beforeClip);

  await only.click();
  await waitForToasts(page);
  // The click leaves focus on the payments "only" button, and :focus-within
  // paints that row as hovered. Drop focus, so the row shows its selection only.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await openMenu(page);
  await page.mouse.move(2, 2);
  const afterClip = await frame(page, subjects, clipWidth, clipHeight, 4);
  // "all" only shows while its section title is hovered.
  const ownersTitle = page.locator('.diffseek-menu-section:has([data-filter-kind="owners"]) .diffseek-menu-section-title');
  const ownersAll = ownersTitle.locator('[data-filter-all]');
  await ownersTitle.hover();
  await cursorOn(page, ownersAll);
  await page.waitForTimeout(300);
  await expectOnlyAllHovered(page);
  const afterCrop = halfCrop(await menu.boundingBox(), afterClip);
  const allBox = await outBox(ownersAll, afterClip, afterCrop, 640);
  // The restore icon in the menu's top right corner brings every section back.
  const resetBox = await outBox(menu.locator('[data-reset-filters]'), afterClip, afterCrop, 640);
  const afterShot = await shoot(page, afterClip);
  return { beforeShot, afterShot, beforeCrop, afterCrop, onlyBox, allBox, resetBox };
}

/** In the After half, the "all" pill is the one hovered thing in the menu. */
async function expectOnlyAllHovered(page: Page): Promise<void> {
  const state = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    const rows = [...(menu?.querySelectorAll('.diffseek-menu-row') ?? [])];
    const all = menu?.querySelector('.diffseek-menu-section:has([data-filter-kind="owners"]) [data-filter-all]');
    const payments = rows.find((row) => row.querySelector('[data-filter-value="@acme/payments"]'));
    const paymentsOnly = payments?.querySelector('.diffseek-menu-only');
    return {
      busy: rows.filter((row) => row.matches(':hover, :focus-within')).map((row) => (row.textContent ?? '').trim()),
      allHovered: Boolean(all?.matches(':hover')),
      paymentsBackground: payments && getComputedStyle(payments).backgroundColor,
      paymentsOnly: paymentsOnly && getComputedStyle(paymentsOnly).opacity,
    };
  }, menuSelector);
  if (state.busy.length > 0 || !state.allHovered || state.paymentsOnly !== '0') {
    throw new Error(`Only the "all" pill should look hovered: ${JSON.stringify(state)}`);
  }
}

/**
 * Tree and menu badges at the 12/82 baseline, with no toast on screen. The
 * shot shows the full viewport width, so it runs at a lower zoom than the
 * others.
 */
export async function viewedBadges(page: Page): Promise<ViewedBadgesCapture> {
  await settleCounts(page);
  await closeMenu(page);
  await expandTo(page, 'web');
  // Fold the other top-level folders so web sits under the tab bar.
  const others = await page.evaluate(() =>
    [...document.querySelectorAll('[role="treeitem"][aria-expanded="true"]')]
      .filter((node) => node.id !== 'web' && !node.id.startsWith('web/'))
      .filter((node) => !node.parentElement?.closest('[role="treeitem"][aria-expanded="true"]:not([id="web"])'))
      .map((node) => node.id),
  );
  for (const id of others) {
    // An open folder's box covers its children, so click its own chevron.
    await page.locator(`[role="treeitem"][id="${id}"] > div .PRIVATE_TreeView-item-toggle`).first().click();
    await page.waitForTimeout(200);
  }
  const folder = treeRow(page, 'web');
  const action = await ownAction(folder);
  if ((await action.getAttribute(pressed)) !== 'mixed') {
    throw new Error(`web folder circle is ${await action.getAttribute(pressed)}, expected mixed at the 12/82 baseline`);
  }
  await openMenu(page);
  await waitForQuiet(page);
  if ((await (await ownAction(folder)).getAttribute(pressed)) !== 'mixed') throw new Error('web folder left the baseline');
  const clip = await tabBarClip(page);
  await restPointer(page);
  const web = webRow(page).locator('[data-diffseek-menu-viewed-action]');
  const boxes = {
    folder: await outBox(await discOf(await ownAction(folder)), clip, 0, 0),
    circle: await outBox(await discOf(web), clip, 0, 0),
    menu: await outBox(page.locator(menuSelector), clip, 0, 0),
    tree: await outBox(page.locator('[role="tree"]'), clip, 0, 0),
  };
  await expectNoToast(page);
  const shot = await shoot(page, clip);
  return { shot, boxes };
}
