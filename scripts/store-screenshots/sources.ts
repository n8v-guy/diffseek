import type { Locator, Page } from '@playwright/test';

import {
  type Box,
  clipHeight,
  clipWidth,
  compareUrl,
  gutter,
  menuSelector,
  outHeight,
  outWidth,
  type Rect,
  scale,
  type Shot,
} from './config.ts';
import { frame, outBox, settleLayout, shoot } from './geometry.ts';
import { paymentsRow, settleCounts } from './page.ts';

export type SourceKey = 'generated' | 'payments' | 'tests' | 'typescript';
export interface SourcesCapture {
  menuCrop: number;
  menuFrame: Box;
  menuLeft: number;
  menuRows: Record<'other' | SourceKey, Box>;
  menuShot: Shot;
  source: Record<SourceKey, Box>;
  sourceShot: Shot;
}

interface CommentCut {
  cellSelector: string;
  codeSelector: string;
  lineAttribute: string;
  selectors: string[];
}

const owners = 'CODEOWNERS';
const attributes = '.gitattributes';
const blobCodeSelector = '.blob-code-inner';
const lineNumberAttribute = 'data-line-number';
const lineCell = `td[${lineNumberAttribute}]`;
const entrySelector = (filePath: string): string =>
  `copilot-diff-entry[data-file-path="${filePath}"]`;
// Formats with no linguist-language line fall back to the file extension.
const otherFormats = ['proto', 'snap', 'sql', 'yaml'];
// The lines each menu row reads, under a comment line just above `first`.
const sourceRuns: Record<SourceKey, { file: string; first: number; last: number }> = {
  generated: { file: attributes, first: 4, last: 7 },
  payments: { file: owners, first: 10, last: 11 },
  tests: { file: attributes, first: 20, last: 23 },
  typescript: { file: attributes, first: 26, last: 27 },
};
// The menu keeps a strip on the right; the labels sit between it and the
// source lines.
const menuStrip = 430;
const lineRange = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

/**
 * Left: GitHub's own compare view of the base branch against its
 * README-only first commit, where CODEOWNERS and .gitattributes show as
 * added files. Right: the DiffSeek menu on the PR. Labels sit beside the
 * source lines, with arrows to the menu rows they feed.
 */
export async function sourcesSplit(page: Page): Promise<SourcesCapture> {
  const menu = await captureMenu(page);
  await page.goto(compareUrl, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  const entry = (filePath: string): Locator => page.locator(entrySelector(filePath));
  await entry(owners).locator(lineCell).first().waitFor({ timeout: 60_000 });
  await entry(attributes).locator(lineCell).first().waitFor({ timeout: 60_000 });
  await trimCompare(page);
  const ownersEntry = entry(owners);
  await ownersEntry.evaluate((element) => { element.scrollIntoView({ block: 'start' }); });
  await page.evaluate(() => {
    const { window } = globalThis;
    window.scrollBy({ top: -12 });
  });
  await settleLayout(page);
  const top = await ownersEntry.boundingBox();
  if (!top) throw new Error('CODEOWNERS is off screen');
  // A little smaller than the menu, so the longest source line clears the
  // label column.
  const sourceZoom = 1.35;
  const margin = { left: 4, top: 10 };
  const sourceClip = { height: outHeight / sourceZoom, width: outWidth / sourceZoom, x: top.x - margin.left, y: top.y - margin.top, zoom: sourceZoom };
  // Highlight the code text, not the full-width row. compose() trims the
  // box where it would run under its label.
  const sourceBox = async (key: SourceKey): Promise<Box> => outBox(await lineRows(page, key), sourceClip);
  const source = {
    generated: await sourceBox('generated'),
    payments: await sourceBox('payments'),
    tests: await sourceBox('tests'),
    typescript: await sourceBox('typescript'),
  };
  const sourceShot = await shoot(page, sourceClip);
  return { sourceShot, ...menu, source };
}

async function captureMenu(page: Page): Promise<Omit<SourcesCapture, 'source' | 'sourceShot'>> {
  await settleCounts(page);
  const menu = page.locator(menuSelector);
  const rowOf = (kind: string, value: string): Locator =>
    menu.locator(`.diffseek-menu-row:has([data-filter-kind="${kind}"][data-filter-value="${value}"])`);
  const rows: Record<SourceKey, Locator> = {
    generated: rowOf('generated', 'true'),
    payments: await paymentsRow(page),
    tests: rowOf('groups', 'Tests'),
    typescript: rowOf('languages', 'TypeScript'),
  };
  const formatRow = (name: string): Locator =>
    menu.locator('.diffseek-menu-row').filter({
      has: page.locator('[data-filter-kind="languages"]').getByText(name, { exact: true }),
    }).first();
  const menuClip = await frame(
    page,
    [menu.locator('[data-filter-kind="viewed"]'), formatRow(otherFormats.at(-1) ?? '')],
    { height: clipHeight, pad: 12, width: clipWidth },
  );
  await page.mouse.move(2, 2);
  const menuLeft = outWidth - menuStrip;
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('The filter menu is off screen');
  const menuCrop = Math.round((menuBox.x - menuClip.x) * scale - gutter);
  const placement = { crop: menuCrop, left: menuLeft };
  // The menu's own box on the canvas; the page around it is painted white.
  const menuFrame = await outBox(menuBox, menuClip, placement);
  const box = (row: Locator): Promise<Box> => outBox(row, menuClip, placement);
  const found = {
    generated: await box(rows.generated),
    payments: await box(rows.payments),
    tests: await box(rows.tests),
    typescript: await box(rows.typescript),
  };
  const formatBoxes: Box[] = [];
  for (const name of otherFormats) formatBoxes.push(await box(formatRow(name)));
  // Trim where the TypeScript row meets proto, so the two outlines keep a gap.
  const trim = { other: 8, typescript: 6 };
  found.typescript = { ...found.typescript, h: found.typescript.h - trim.typescript };
  const otherTop = Math.min(...formatBoxes.map((item) => item.y)) + trim.other;
  const [firstFormat] = formatBoxes;
  if (!firstFormat) throw new Error('No other format rows');
  const other = {
    h: Math.max(...formatBoxes.map((item) => item.y + item.h)) - otherTop,
    w: firstFormat.w,
    x: firstFormat.x,
    y: otherTop,
  };
  const menuShot = await shoot(page, menuClip);
  return { menuCrop, menuFrame, menuLeft, menuRows: { ...found, other }, menuShot };
}

/**
 * The kept lines jump (9-11, then 3-7, 19-23, 25-27), so each comment line
 * becomes a thin white cutout. Every chunk then reads as an excerpt.
 */
function cutCommentRows({
  cellSelector,
  codeSelector,
  lineAttribute,
  selectors,
}: CommentCut): void {
  const { document } = globalThis;
  const blank: [string, string][] = [
    ['background', '#fff'],
    ['height', '10px'],
    ['padding', '0'],
    ['border', '0'],
    ['font-size', '0'],
    ['line-height', '0'],
  ];

  const isComment = (row: HTMLTableRowElement): boolean => {
    if (row.style.display === 'none' || row.querySelector(cellSelector) === null) return false;
    const code = row.querySelector(codeSelector) ?? row.lastElementChild;
    return (code?.textContent ?? '').trimStart().startsWith('#');
  };

  const blankRow = (row: HTMLTableRowElement): void => {
    row.style.setProperty('height', '10px', 'important');
    for (const cell of row.querySelectorAll('td')) {
      cell.textContent = '';
      cell.removeAttribute(lineAttribute);
      for (const [key, value] of blank) cell.style.setProperty(key, value, 'important');
    }
  };

  for (const selector of selectors) {
    for (const row of document.querySelector(selector)?.querySelectorAll('tr') ?? []) {
      if (isComment(row)) blankRow(row);
    }
  }
}

/** Added files have no old-side line numbers; fold that empty column. */
function foldOldColumn(selectors: string[]): void {
  const { document } = globalThis;
  const foldFile = (selector: string): void => {
    const file = document.querySelector(selector);
    for (const row of file?.querySelectorAll('tr') ?? []) {
      const first = row.querySelector('td');
      const oldColumn = first !== null
        && first.className.includes('blob-num')
        && row.querySelectorAll('td[class*="blob-num"]').length === 2;
      if (oldColumn) first.style.display = 'none';
    }
    for (const column of file?.querySelectorAll<HTMLElement>('colgroup col:first-child') ?? []) {
      column.style.display = 'none';
    }
  };
  for (const selector of selectors) foldFile(selector);
}

function hideCodeownersErrors(selector: string): void {
  const { document } = globalThis;
  for (const node of document.querySelectorAll(`${selector} *`)) {
    const text = node.textContent;
    const bannerChildLimit = 4;
    const errorBanner = node.children.length < bannerChildLimit
      && text.includes('contains errors')
      && node.closest('table') === null;
    if (!errorBanner) continue;
    const block = node.closest('.js-file-content > div, .js-file-content > *') ?? node;
    if (!(block instanceof HTMLElement) || block.querySelector('table') !== null) {
      continue;
    }
    block.style.display = 'none';
  }
}

/** Code-text box of the lines one menu row reads. */
function lineRows(page: Page, key: SourceKey): Promise<Rect> {
  const run = sourceRuns[key];
  return page.evaluate(({ cellSelector, codeSelector, lineAttribute, numbers, selector }) => {
    const { document } = globalThis;
    const file = document.querySelector(selector);
    const rows = [...(file?.querySelectorAll('tr') ?? [])].filter((row) =>
      [...row.querySelectorAll(cellSelector)].some((cell) =>
        numbers.includes(Number(cell.getAttribute(lineAttribute) ?? '')),
      ),
    );
    // Measure the code text itself, not the full-width row.
    const boxes = rows.map((row) => {
      const code = row.querySelector(codeSelector) ?? row.lastElementChild ?? row;
      const range = document.createRange();
      range.selectNodeContents(code);
      const text = range.getBoundingClientRect();
      const cell = row.getBoundingClientRect();
      const pad = 4;
      return { bottom: cell.bottom, left: text.left - pad, right: text.right + pad, top: cell.top };
    });
    const x = Math.min(...boxes.map((box) => box.left));
    const y = Math.min(...boxes.map((box) => box.top));
    return {
      height: Math.max(...boxes.map((box) => box.bottom)) - y,
      width: Math.max(...boxes.map((box) => box.right)) - x,
      x,
      y,
    };
  }, {
    cellSelector: lineCell,
    codeSelector: blobCodeSelector,
    lineAttribute: lineNumberAttribute,
    numbers: lineRange(run.first, run.last),
    selector: entrySelector(run.file),
  });
}

/** GitHub lists .gitattributes first; put CODEOWNERS on top. */
function ownersFirst([ownersSelector, attributesSelector]: string[]): void {
  const { document } = globalThis;

  const query = (selector: string | undefined): Element | null => {
    if (selector === undefined || selector === '') return null;
    return document.querySelector(selector);
  };
  let ownersElement = query(ownersSelector);
  let attributesElement = query(attributesSelector);
  if (ownersElement === null || attributesElement === null) return;
  while (ownersElement.parentElement !== attributesElement.parentElement) {
    const parent: Element | null = ownersElement.parentElement;
    if (parent?.contains(attributesElement) === true) attributesElement = parent;
    else ownersElement = parent;
    if (ownersElement === null) return;
  }
  ownersElement.parentElement?.insertBefore(ownersElement, attributesElement);
}

/** Leaves only the kept CODEOWNERS and .gitattributes lines on the compare page. */
async function trimCompare(page: Page): Promise<void> {
  // Lines kept on GitHub's compare page; the rest of each file is folded away.
  const keptLines: Record<string, number[]> = {};
  for (const { file, first, last } of Object.values(sourceRuns)) {
    keptLines[file] = [...(keptLines[file] ?? []), ...lineRange(first - 1, last)];
  }
  const kept = Object.keys(keptLines);
  const files = Object.fromEntries(Object.entries(keptLines).map(([filePath, lines]) => [entrySelector(filePath), lines]));
  await page.evaluate(({ cellSelector, keep, lineAttribute }) => {
    const { document } = globalThis;
    for (const [selector, lines] of Object.entries(keep)) {
      const file = document.querySelector(selector);
      for (const row of file?.querySelectorAll('tr') ?? []) {
        const numbers = [...row.querySelectorAll(cellSelector)].map((cell) =>
          Number(cell.getAttribute(lineAttribute) ?? ''),
        );
        if (numbers.length > 0 && numbers.every((number) => !lines.includes(number))) {
          row.style.display = 'none';
        }
      }
    }
  }, { cellSelector: lineCell, keep: files, lineAttribute: lineNumberAttribute });
  // Show only these two files, and drop the banner GitHub adds because the
  // demo @acme teams do not exist on this account. A style rule also
  // catches files and banners that GitHub streams in later.
  await page.evaluate((paths) => {
    const { document } = globalThis;
    const style = document.createElement('style');
    let selector = 'copilot-diff-entry';
    for (const filePath of paths) selector += `:not([data-file-path="${filePath}"])`;
    style.textContent = `${selector}{display:none!important}.js-codeowners-errors,footer{display:none!important}`;
    document.head.append(style);
    // With only two short files left, the page can end above the shot, and
    // the browser then clamps the scroll mid-capture. Keep blank room below.
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.body.append(spacer);
  }, kept);
  await page.evaluate(foldOldColumn, Object.keys(files));
  await page.evaluate(hideCodeownersErrors, entrySelector(owners));
  await page.evaluate(cutCommentRows, {
    cellSelector: lineCell,
    codeSelector: blobCodeSelector,
    lineAttribute: lineNumberAttribute,
    selectors: Object.keys(files),
  });
  await page.evaluate(ownersFirst, [entrySelector(owners), entrySelector(attributes)]);
}
