import { expect, type Page, test } from '@playwright/test';
import '@diffseek/browser/page-globals';

import {
  closeExtensionPages,
  expectPressedViewed,
  labelAttribute,
  markAll,
  markAllViewed,
  markRest,
  openPull,
  pressedAttribute,
  resetExtensionStorage,
  snackbarSelector,
  startExtensionBrowser,
  stopExtensionBrowser,
} from './review-e2e.support';

test.beforeAll(startExtensionBrowser);

test.beforeEach(resetExtensionStorage);

test.afterEach(closeExtensionPages);

test.afterAll(stopExtensionBrowser);

test('stays idempotent through a deterministic native-extension action storm', async () => {
  const page = await openPull(4);
  await page.getByLabel('Filter options').click();

  const code = page.locator(
    '[data-filter-kind="groups"][data-filter-value="Code"]',
  );
  await code.click();
  // Resolve on the events themselves: GitHub expands the file, then DiffSeek
  // collapses it again.
  await page.evaluate(() => {
    const gate = Promise.withResolvers<undefined>();
    Object.defineProperty(globalThis, 'recollapsed', {
      configurable: true,
      value: gate.promise,
      writable: true,
    });
    let expanded = false;
    const host = globalThis;
    const observer = new host.MutationObserver(() => {
      const label = globalThis.document.querySelector('#diff-app button')?.getAttribute('aria-label');
      if (label === 'Collapse file') expanded = true;
      else if (expanded && label === 'Expand file') {
        observer.disconnect();
        gate.resolve(undefined);
      }
    });
      const diff = globalThis.document.getElementById('diff-app');
      if (diff === null) throw new Error('Missing diff-app');
      observer.observe(diff, {
        attributeFilter: ['aria-label'],
        attributes: true,
        childList: true,
        subtree: true,
      });
  });
  await page.locator('#diff-app button[aria-label="Expand file"]').click();
  await page.evaluate(() => globalThis.recollapsed);
  await expect(
    page.locator('#diff-app button[aria-label="Expand file"]'),
  ).toHaveCount(1);

  await code.click();
  await expect(
    page.locator('#diff-app button[aria-label="Collapse file"]'),
  ).toHaveCount(1);
  await page.locator('#diff-app button[aria-label="Collapse file"]').click();
  await code.click();
  await code.click();
  await expect(
    page.locator('#diff-app button[aria-label="Expand file"]'),
  ).toHaveCount(1);

  await page.evaluate(() => {
    const tree = globalThis.document.querySelector('[role="tree"]');
    tree?.replaceWith(tree.cloneNode(true));
    const menu = globalThis.document.querySelector('[role="menu"]');
    menu?.replaceWith(menu.cloneNode(true));
  });
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(1);

  await page.evaluate(() => {
    const delayKey = 'nativeDelay';
    globalThis.document.documentElement.dataset[delayKey] = '75';
  });
  await markAllViewed(page);
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(1);
  await expect(page.locator('[data-diffseek-filtered-out]')).toHaveCount(0);
});

test('retains collapsed folders and marks only visible facet files', async () => {
  const page = await openPull(6);
  await page.evaluate(() => {
    const folder = globalThis.document.getElementById('src');
    const group = globalThis.document.createElement('ul');
    group.setAttribute('role', 'group');
    for (const filePath of ['src/app.ts', 'src/new.ts', 'src/generated.ts']) {
      const item = globalThis.document.getElementById(filePath);
      if (item) group.append(item);
    }
    folder?.setAttribute('aria-expanded', 'true');
    folder?.append(group);
  });
  await page.getByLabel('Filter options').click();

  const codeCounter = page.locator(
    '[data-diffseek-menu-count-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
  );
  await expect(codeCounter).toHaveText('3/3');
  await page
    .locator('[data-filter-kind="generated"][data-filter-value="true"]')
    .click();
  await expect(codeCounter).toHaveText('2/3');

  await page.evaluate(() => {
    const folder = globalThis.document.getElementById('src');
    folder?.setAttribute('aria-expanded', 'false');
    folder?.querySelector('[role="group"]')?.remove();
  });
  await expect(page.locator('#src')).toBeVisible();
  await expect(codeCounter).toHaveText('2/3');

  const codeViewed = page.locator(
    '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
  );
  await expect(codeViewed).toHaveAttribute(labelAttribute, markAll);
  await expect(codeCounter).toHaveAttribute(labelAttribute, markAll);
  await expect(codeViewed).toHaveAttribute(pressedAttribute, 'false');
  const badgeStyle = await codeViewed.evaluate((action) => ({
    height: getComputedStyle(action, '::before').height,
    right: getComputedStyle(action, '::before').right,
    width: getComputedStyle(action, '::before').width,
  }));
  expect(badgeStyle).toEqual({
    height: '12px',
    right: '-4px',
    width: '12px',
  });
  await codeCounter.click();
  await expectPressedViewed(page);
  // The progress toast is replaced in place by the outcome.
  await expect(page.locator('html')).toHaveAttribute(
    'data-toast-log',
    /^Marking all files in category viewed…\nAll files in category marked viewed$/mv,
  );
  await expect(page.locator(snackbarSelector)).toHaveText([
    'All files in category marked viewed',
  ]);

  await page.locator('#diff-app button[aria-label="Viewed"]').click();
  await expect(codeViewed).toHaveAttribute(labelAttribute, markRest);
  await expect(codeCounter).toHaveAttribute(labelAttribute, markRest);
  await expect(codeViewed).toHaveAttribute(pressedAttribute, 'mixed');
  await expect(codeViewed).toHaveClass(/diffseek-viewed-partial/v);
  const eclipse = await codeViewed.evaluate((action) => {
    const before = getComputedStyle(action, '::before');
    const after = getComputedStyle(action, '::after');
    return {
      afterContent: after.content,
      backgroundImage: before.backgroundImage,
    };
  });
  expect(eclipse.backgroundImage).toContain('radial-gradient');
  expect(eclipse.backgroundImage).toContain('36%');
  expect(eclipse.backgroundImage).toContain('2.3px');
  expect(eclipse.afterContent).toBe('none');
  await markVisibleCodeFiles(page, codeViewed, codeCounter);
});

async function markVisibleCodeFiles(
  page: Page,
  codeViewed: ReturnType<Page['locator']>,
  codeCounter: ReturnType<Page['locator']>,
): Promise<void> {
  await codeViewed.click();
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'true');

  await page
    .locator('[data-filter-kind="viewed"][data-filter-value="true"]')
    .click();
  await expect(codeCounter).toHaveText('0/3');
  await expect(codeViewed).toHaveAttribute(
    labelAttribute,
    'Unmark all',
  );
  await expect(codeCounter).toHaveAttribute(
    labelAttribute,
    'Unmark all',
  );
  await codeCounter.click();
  await expect(
    page.locator('#diff-app button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
  await expect(
    page.locator('#diff-new button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
  await expect(codeCounter).toHaveText('2/3');
  await expect(codeViewed).toHaveAttribute(labelAttribute, markAll);
  await expect(codeViewed).toHaveAttribute(pressedAttribute, 'false');

  const generatedCircle = page.locator(
    '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"]',
  );
  await expect(generatedCircle).toHaveAttribute(
    labelAttribute,
    'Mark all viewed',
  );
  const separated = await generatedCircle.evaluate((circle) => {
    const pill = globalThis.document.querySelector('[data-diffseek-always-read]');
    const box = circle.getBoundingClientRect();
    const pillBox = pill?.getBoundingClientRect();
    const overlaps = Boolean(
      pillBox &&
        box.left < pillBox.right &&
        box.right > pillBox.left &&
        box.top < pillBox.bottom &&
        box.bottom > pillBox.top,
    );
    return {
      overlapsPill: overlaps,
      snackInsideRow: globalThis.document.querySelector('[data-diffseek="snackbar"]')
        ?.closest('.diffseek-menu-row') !== null,
    };
  });
  expect(separated).toEqual({ overlapsPill: false, snackInsideRow: false });
  await generatedCircle.click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'true');
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeHidden();
  await expect(generatedCircle).toHaveAttribute(pressedAttribute, 'true');
  await generatedCircle.click();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
}
