import type { Locator, Page } from '@playwright/test';

import {
  clipHeight,
  clipWidth,
  compareUrl,
  menuSelector,
  outHeight,
  outWidth,
  scale,
  sourceLines,
  type Box,
  type Rect,
  type Shot,
} from './config.ts';
import { frame, outBox, settleLayout, shoot } from './geometry.ts';
import { paymentsRow, settleCounts } from './page.ts';

export type SourceKey = 'generated' | 'payments' | 'tests' | 'typescript';
export type SourcesCapture = {
  sourceShot: Shot;
  menuShot: Shot;
  menuLeft: number;
  menuCrop: number;
  menuFrame: Box;
  menuRows: Record<SourceKey | 'other', Box>;
  source: Record<SourceKey, Box>;
};

const owners = 'CODEOWNERS';
const attributes = '.gitattributes';
const lineCell = 'td[data-line-number]';
const entrySelector = (path: string) => `copilot-diff-entry[data-file-path="${path}"]`;
// Formats with no linguist-language line fall back to the file extension.
const otherFormats = ['proto', 'snap', 'sql', 'yaml'];

/**
 * Left: GitHub's own compare view of the base branch against its
 * README-only first commit, where CODEOWNERS and .gitattributes show as
 * added files. Right: the DiffSeek menu on the PR. Labels sit beside the
 * source lines, with arrows to the menu rows they feed.
 */
export async function sourcesSplit(page: Page): Promise<SourcesCapture> {
  const menu = await captureMenu(page);
  await page.goto(compareUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const entry = (path: string) => page.locator(entrySelector(path));
  await entry(owners).locator(lineCell).first().waitFor({ timeout: 60_000 });
  await entry(attributes).locator(lineCell).first().waitFor({ timeout: 60_000 });
  await trimCompare(page);
  const ownersEntry = entry(owners);
  await ownersEntry.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -12));
  await settleLayout(page);
  const top = await ownersEntry.boundingBox();
  if (!top) throw new Error('CODEOWNERS is off screen');
  // A little smaller than the menu, so the longest source line clears the
  // label column.
  const sourceZoom = 1.35;
  const sourceClip = { x: top.x - 4, y: top.y - 10, width: outWidth / sourceZoom, height: outHeight / sourceZoom, zoom: sourceZoom };
  const lines: Record<SourceKey, Rect> = {
    payments: await lineRows(page, owners, [10, 11]),
    generated: await lineRows(page, attributes, [4, 5, 6, 7]),
    tests: await lineRows(page, attributes, [20, 21, 22, 23]),
    typescript: await lineRows(page, attributes, [26, 27]),
  };
  // Highlight the code text, not the full-width row. compose() trims the
  // box where it would run under its label.
  const source = {
    payments: await outBox(lines.payments, sourceClip, 0, 0),
    generated: await outBox(lines.generated, sourceClip, 0, 0),
    tests: await outBox(lines.tests, sourceClip, 0, 0),
    typescript: await outBox(lines.typescript, sourceClip, 0, 0),
  };
  const sourceShot = await shoot(page, sourceClip);
  return { sourceShot, ...menu, source };
}

async function captureMenu(page: Page): Promise<Omit<SourcesCapture, 'sourceShot' | 'source'>> {
  await settleCounts(page);
  const menu = page.locator(menuSelector);
  const rowOf = (kind: string, value: string) => menu.locator(`.diffseek-menu-row:has([data-filter-kind="${kind}"][data-filter-value="${value}"])`);
  const rows: Record<SourceKey, Locator> = {
    generated: rowOf('generated', 'true'),
    payments: await paymentsRow(page),
    tests: rowOf('groups', 'Tests'),
    typescript: rowOf('languages', 'TypeScript'),
  };
  const formatRow = (name: string) => menu.locator('.diffseek-menu-row').filter({ has: page.locator('[data-filter-kind="languages"]').getByText(name, { exact: true }) }).first();
  const menuClip = await frame(page, [menu.locator('[data-filter-kind="viewed"]'), formatRow(otherFormats.at(-1) ?? '')], clipWidth, clipHeight);
  await page.mouse.move(2, 2);
  // The menu keeps a 430px strip on the right; the labels sit between it
  // and the source lines.
  const menuLeft = outWidth - 430;
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('The filter menu is off screen');
  const menuCrop = Math.round((menuBox.x - menuClip.x) * scale - 16);
  // The menu's own box on the canvas; the page around it is painted white.
  const menuFrame = await outBox(menuBox, menuClip, menuCrop, menuLeft);
  const box = (row: Locator) => outBox(row, menuClip, menuCrop, menuLeft);
  const found = {
    generated: await box(rows.generated),
    payments: await box(rows.payments),
    tests: await box(rows.tests),
    typescript: await box(rows.typescript),
  };
  const formatBoxes: Box[] = [];
  for (const name of otherFormats) formatBoxes.push(await box(formatRow(name)));
  // Trim where the TypeScript row meets proto, so the two outlines keep a gap.
  found.typescript = { ...found.typescript, h: found.typescript.h - 6 };
  const otherTop = Math.min(...formatBoxes.map((item) => item.y)) + 8;
  const [firstFormat] = formatBoxes;
  if (!firstFormat) throw new Error('No other format rows');
  const other = {
    x: firstFormat.x,
    y: otherTop,
    w: firstFormat.w,
    h: Math.max(...formatBoxes.map((item) => item.y + item.h)) - otherTop,
  };
  const menuShot = await shoot(page, menuClip);
  return { menuShot, menuLeft, menuCrop, menuFrame, menuRows: { ...found, other } };
}

/** Code-text box of the given line numbers in one compare file. */
function lineRows(page: Page, path: string, numbers: number[]): Promise<Rect> {
  return page.evaluate(({ selector, lineNumbers, cellSelector }) => {
    const file = document.querySelector(selector);
    const rows = [...(file?.querySelectorAll('tr') ?? [])].filter((row) =>
      [...row.querySelectorAll(cellSelector)].some((cell) =>
        lineNumbers.includes(Number(cell.getAttribute('data-line-number'))),
      ),
    );
    // Measure the code text itself, not the full-width row.
    const boxes = rows.map((row) => {
      const code = row.querySelector('.blob-code-inner') ?? row.lastElementChild ?? row;
      const range = document.createRange();
      range.selectNodeContents(code);
      const text = range.getBoundingClientRect();
      const cell = row.getBoundingClientRect();
      return { left: text.left - 4, right: text.right + 4, top: cell.top, bottom: cell.bottom };
    });
    const x = Math.min(...boxes.map((box) => box.left));
    const y = Math.min(...boxes.map((box) => box.top));
    return { x, y, width: Math.max(...boxes.map((box) => box.right)) - x, height: Math.max(...boxes.map((box) => box.bottom)) - y };
  }, { selector: entrySelector(path), lineNumbers: numbers, cellSelector: lineCell });
}

/** Leaves only the kept CODEOWNERS and .gitattributes lines on the compare page. */
async function trimCompare(page: Page): Promise<void> {
  const kept = Object.keys(sourceLines);
  const files = Object.fromEntries(kept.map((path) => [entrySelector(path), sourceLines[path] ?? []]));
  await page.evaluate(({ keep, cellSelector }) => {
    for (const [selector, lines] of Object.entries(keep)) {
      for (const row of document.querySelector(selector)?.querySelectorAll('tr') ?? []) {
        const numbers = [...row.querySelectorAll(cellSelector)].map((cell) => Number(cell.getAttribute('data-line-number')));
        if (numbers.length > 0 && !numbers.some((number) => lines.includes(number))) row.style.display = 'none';
      }
    }
  }, { keep: files, cellSelector: lineCell });
  // Show only these two files, and drop the banner GitHub adds because the
  // demo @acme teams do not exist on this account. A style rule also
  // catches files and banners that GitHub streams in later.
  await page.evaluate((paths) => {
    const style = document.createElement('style');
    const excluded = paths.reduce(
      (rule, path) => `${rule}:not([data-file-path="${path}"])`,
      'copilot-diff-entry',
    );
    style.textContent = `${excluded}{display:none!important}.js-codeowners-errors,footer{display:none!important}`;
    document.head.append(style);
    // With only two short files left, the page can end above the shot, and
    // the browser then clamps the scroll mid-capture. Keep blank room below.
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.body.append(spacer);
  }, kept);
  await page.evaluate(foldOldColumn, Object.keys(files));
  await page.evaluate(hideCodeownersErrors, entrySelector(owners));
  await page.evaluate(cutCommentRows, { selectors: Object.keys(files), cellSelector: lineCell });
  await page.evaluate(ownersFirst, [entrySelector(owners), entrySelector(attributes)]);
}

/** Added files have no old-side line numbers; fold that empty column. */
function foldOldColumn(selectors: string[]): void {
  for (const selector of selectors) {
    const file = document.querySelector(selector);
    for (const row of file?.querySelectorAll('tr') ?? []) {
      const first = row.querySelector('td');
      if (first && /blob-num/.test(first.className) && row.querySelectorAll('td[class*="blob-num"]').length === 2) first.style.display = 'none';
    }
    for (const col of file?.querySelectorAll<HTMLElement>('colgroup col:first-child') ?? []) col.style.display = 'none';
  }
}

function hideCodeownersErrors(selector: string): void {
  for (const node of document.querySelectorAll(`${selector} *`)) {
    if (node.children.length >= 4 || !/contains errors/.test(node.textContent) || node.closest('table')) continue;
    const block = node.closest<HTMLElement>('.js-file-content > div, .js-file-content > *') ?? (node as HTMLElement);
    if (!block.querySelector('table')) block.style.display = 'none';
  }
}

/**
 * The kept lines jump (9-11, then 3-7, 19-23, 25-27), so each comment line
 * becomes a thin white cutout. Every chunk then reads as an excerpt.
 */
function cutCommentRows({ selectors, cellSelector }: { selectors: string[]; cellSelector: string }): void {
  const blank: Array<[string, string]> = [['background', '#fff'], ['height', '10px'], ['padding', '0'], ['border', '0'], ['font-size', '0'], ['line-height', '0']];
  for (const selector of selectors) {
    for (const row of document.querySelector(selector)?.querySelectorAll('tr') ?? []) {
      if (row.style.display === 'none' || !row.querySelector(cellSelector)) continue;
      const code = row.querySelector('.blob-code-inner') ?? row.lastElementChild;
      if (!/^#/.test((code?.textContent ?? '').trim())) continue;
      row.style.setProperty('height', '10px', 'important');
      for (const cell of row.querySelectorAll('td')) {
        cell.textContent = '';
        cell.removeAttribute('data-line-number');
        for (const [key, value] of blank) cell.style.setProperty(key, value, 'important');
      }
    }
  }
}

/** GitHub lists .gitattributes first; put CODEOWNERS on top. */
function ownersFirst([ownersSelector, attributesSelector]: string[]): void {
  let a = ownersSelector ? document.querySelector(ownersSelector) : null;
  let b = attributesSelector ? document.querySelector(attributesSelector) : null;
  while (a && b && a.parentElement !== b.parentElement) {
    if (a.parentElement?.contains(b)) b = b.parentElement;
    else a = a.parentElement;
  }
  if (a && b) a.parentElement?.insertBefore(a, b);
}
