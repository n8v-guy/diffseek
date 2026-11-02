import type { ElementHandle, Locator, Page } from '@playwright/test';

import { treeItemSelector, viewedActionSelector } from './config.ts';

const expandedAttribute = 'aria-expanded';
const missingRowLabel = 'a row';
const pressedAttribute = 'aria-pressed';

/** Every file row id in the tree, scrolling it so virtualised rows render. */
export async function collectFileIds(page: Page): Promise<string[]> {
  return (await collectFileStates(page)).keys().toArray();
}

/** Each file row's viewed circle state, keyed by path. */
export async function collectFileStates(page: Page): Promise<Map<string, null | string>> {
  await expandAll(page);
  const seen = new Map<string, null | string>();
  for (let step = 0; step < 40; step += 1) {
    const rows = await page.evaluate(
      ({ action, expanded, item, pressed }) => {
        const { document } = globalThis;
        return [...document.querySelectorAll(`${item}[id]`)].flatMap((node): [string, null | string][] => {
          if (node.hasAttribute(expanded)) return [];
          const own = [...node.querySelectorAll(action)].find((child) => child.closest(item) === node);
          return [[node.id, own?.getAttribute(pressed) ?? null]];
        });
      },
      {
        action: viewedActionSelector,
        expanded: expandedAttribute,
        item: treeItemSelector,
        pressed: pressedAttribute,
      },
    );
    for (const [id, pressed] of rows) seen.set(id, pressed);
    if (!(await scrollTree(page))) break;
    await page.waitForTimeout(150);
  }
  return seen;
}

export async function expandTo(page: Page, id: string): Promise<void> {
  const parts = id.split('/');
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const row = treeRow(page, parts.slice(0, depth).join('/'));
    if ((await row.count()) === 0) await expandAll(page);
    // GitHub folds single-child folders into one row, like services/payments.
    if ((await row.count()) === 0 && depth < parts.length) continue;
    if ((await row.getAttribute(expandedAttribute)) === 'false') await toggleFolder(page, row, 200);
  }
}

/** The row's own viewed circle, not one from a nested row. */
export async function ownAction(row: Locator): Promise<ElementHandle<HTMLElement>> {
  // The circle is injected after GitHub renders the row, so give it a moment.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const handle = await row.evaluateHandle(
      (element, { action, item }) =>
        [...element.querySelectorAll<HTMLElement>(action)].find((node) => node.closest(item) === element) ?? null,
      { action: viewedActionSelector, item: treeItemSelector },
    );
    const element = handle.asElement();
    if (element) return element;
    await row.page().waitForTimeout(200);
  }
  throw new Error(`Viewed circle is missing on ${await rowLabel(row)}`);
}

export async function setFileViewed(page: Page, id: string, viewed: boolean): Promise<void> {
  const row = treeRow(page, id);
  if ((await row.count()) === 0) {
    await page.evaluate((filePath) => {
      const { document } = globalThis;
      document.getElementById(filePath)?.scrollIntoView({ block: 'center' });
    }, id);
  }
  try {
    await row.scrollIntoViewIfNeeded();
  } catch {
    // Virtualised rows can detach before the scroll.
  }
  const action = await ownAction(row);
  const pressed = await action.getAttribute(pressedAttribute);
  if ((pressed === 'true') === viewed) return;
  await action.click();
  await page.waitForFunction(({ item, next, path, pressed: pressedName, selector }) => {
    const { document } = globalThis;
    const node = document.getElementById(path);
    const anchor = [...(node?.querySelectorAll(selector) ?? [])].find((child) => child.closest(item) === node);
    return anchor?.getAttribute(pressedName) === (next ? 'true' : 'false');
  }, {
    item: treeItemSelector,
    next: viewed,
    path: id,
    pressed: pressedAttribute,
    selector: viewedActionSelector,
  }, { timeout: 8_000 });
}

export function treeRow(page: Page, id: string): Locator {
  return page.locator(`${treeItemSelector}[id="${id}"]`);
}

async function expandAll(page: Page): Promise<void> {
  for (let guard = 0; guard < 80; guard += 1) {
    const collapsed = page.locator(`${treeItemSelector}[aria-expanded="false"]`);
    if ((await collapsed.count()) === 0) return;
    await toggleFolder(page, collapsed.first(), 150);
  }
}

async function rowLabel(row: Locator): Promise<null | string> {
  try {
    return await row.getAttribute('id');
  } catch {
    return missingRowLabel;
  }
}

function scrollTree(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const { document } = globalThis;
    const tree = document.querySelector('[role="tree"]');
    let node = tree?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight + 4) node = node.parentElement;
    if (!node) return false;
    const before = node.scrollTop;
    node.scrollTop = before + Math.max(240, node.clientHeight * 0.8);
    return node.scrollTop !== before;
  });
}

async function toggleFolder(page: Page, row: Locator, pause: number): Promise<void> {
  const button = row.locator('button').first();
  if ((await button.count()) > 0) await button.click();
  else await row.click();
  await page.waitForTimeout(pause);
}
