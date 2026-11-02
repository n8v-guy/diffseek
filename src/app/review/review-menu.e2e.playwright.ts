import { expect, type Page, test } from '@playwright/test';

import {
  checkedAttribute,
  closeExtensionPages,
  expectMenuGeometry,
  labelAttribute,
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

test('clears native filters before taking over the menu', async () => {
  const page = await openPull(5, true);
  await expect(page.locator('html')).toHaveAttribute(
    'data-native-filter-cleared',
    'true',
  );
  await expect(page.locator('[role="menu"]')).toHaveCount(0);

  await page.getByLabel('Filter options').click();
  const menu = page.locator('[role="menu"]');
  const nativeLanguage = page.getByRole('menuitemcheckbox', { name: '.js' });
  const viewed = page.locator(
    '[data-filter-kind="viewed"][data-filter-value="true"]',
  );
  const generated = page.locator(
    '[data-filter-kind="generated"][data-filter-value="true"]',
  );

  await expect(menu).toHaveAttribute('data-diffseek-menu-owned', 'true');
  await page.locator('html').evaluate((html) => {
    html.dataset['colorMode'] = 'dark';
  });
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCSS(
    'background-color',
    'rgb(43, 33, 70)',
  );
  await page.locator('html').evaluate((html) => {
    delete html.dataset['colorMode'];
  });
  await expect(nativeLanguage).toBeHidden();
  await expect(menu.locator('[role="separator"]').first()).toBeHidden();
  await expect(viewed).toBeVisible();
  await expect(generated).toBeVisible();
  expect(
    await viewed.evaluate(
      (item, generatedItem) =>
        Boolean(
          item.compareDocumentPosition(generatedItem as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await generated.elementHandle(),
    ),
  ).toBe(true);
  await expect(
    page.locator('[data-filter-kind="languages"][data-filter-value="md"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-filter-kind="languages"][data-filter-value="json"]'),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-filter-kind="groups"][data-filter-value="No groups"]',
    ),
  ).toBeVisible();
  await expect(
    menu.locator('.diffseek-menu-section h3'),
  ).toHaveText(['Owners', 'Groups', 'Formats', 'Change status']);

  const ownerRow = page.locator(
    '.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@pull-source"])',
  );
  const ownerItem = ownerRow.locator('.diffseek-menu-item');
  const ownerCounter = ownerRow.locator('.diffseek-menu-count');
  const ownerViewed = ownerRow.locator('.diffseek-menu-viewed-action');
  const ownerOnly = ownerRow.locator('[data-filter-only]');
  await expect(ownerOnly).toHaveCSS('opacity', '0');
  await ownerCounter.hover();
  await expect(ownerRow).toHaveCSS('background-color', 'rgb(228, 220, 255)');
  await expect(ownerOnly).toHaveCSS('opacity', '1');
  await expect(ownerItem).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(ownerViewed).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  const onlyColumns = await page
    .locator(
      '.diffseek-menu-section:has([data-filter-kind="owners"]) [data-filter-only]',
    )
    .evaluateAll((actions) =>
      actions.map((action) => action.getBoundingClientRect().left),
    );
  expect(new Set(onlyColumns.map((column) => Math.round(column))).size).toBe(1);
  await ownerOnly.click();
  await page.locator('#diff-app').hover();
  await expect(ownerRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(ownerOnly).toHaveCSS('opacity', '1');
  await expect(ownerOnly).toHaveCSS('background-color', 'rgb(59, 46, 131)');
  await ownerOnly.evaluate((button) => {
    button.blur();
    button.focus({ focusVisible: true });
  });
  await expect(ownerRow).toHaveCSS('background-color', 'rgb(228, 220, 255)');
  await expect(
    page.locator(
      '[data-filter-kind="owners"]:not([data-filter-value="@pull-source"])',
    ).first(),
  ).toHaveAttribute(checkedAttribute, 'false');
  await expectOwnerSection(page);
});

async function expectOwnerSection(page: Page): Promise<void> {
  const generated = page.locator(
    '[data-filter-kind="generated"][data-filter-value="true"]',
  );
  const ownersTitle = page.locator(
    '.diffseek-menu-section:has([data-filter-kind="owners"]) .diffseek-menu-section-title',
  );
  const ownersAll = ownersTitle.locator('[data-filter-all]');
  await expect(ownersAll).toHaveCSS('opacity', '0');
  await ownersTitle.hover();
  await expect(ownersAll).toHaveCSS('opacity', '1');
  const allAndCounterRight = await ownersAll.evaluate((all) => {
    const section = all.closest('.diffseek-menu-section');
    const counter = section?.querySelector('.diffseek-menu-count');
    if (!counter) throw new Error('Missing owner counter');
    return {
      all: all.getBoundingClientRect().right,
      counter: counter.getBoundingClientRect().right,
    };
  });
  expect(allAndCounterRight.all).toBeCloseTo(
    allAndCounterRight.counter,
    0,
  );
  await ownersAll.click();
  await expect(
    page.locator('[data-filter-kind="owners"][aria-checked="false"]'),
  ).toHaveCount(0);

  const alwaysRead = page.locator('[data-diffseek-always-read]');
  await expect(alwaysRead).toHaveAttribute(pressedAttribute, 'false');
  await generated.click();
  await expect(generated).toHaveAttribute(checkedAttribute, 'false');
  await expect(generated).toHaveAttribute(
    'title',
    '○ Show now\n● Hide now\n○ Always hide',
  );
  await expect(generated).toHaveAttribute(
    labelAttribute,
    'Generated: Hide now, click for Always hide',
  );
  await expect(
    page.locator(snackbarSelector).last(),
  ).toContainText('Hidden');
  await generated.click();
  await expect(generated).toHaveAttribute(checkedAttribute, 'mixed');
  await expect(
    page.locator(snackbarSelector).last(),
  ).toContainText('Always hidden');
  await generated.click();
  await expect(generated).toHaveAttribute(checkedAttribute, 'true');
  await expect(
    page.locator(snackbarSelector).last(),
  ).toContainText('Shown');
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
  await generated.locator('xpath=..').hover();
  await alwaysRead.click();
  await expect(alwaysRead).toHaveAttribute(pressedAttribute, 'true');
  const pressedBackground = await alwaysRead.evaluate(
    (pill) => getComputedStyle(pill).backgroundColor,
  );
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'true');
  await alwaysRead.click();
  await expect(alwaysRead).toHaveAttribute(pressedAttribute, 'false');
  const hoveredBackground = await alwaysRead.evaluate(
    (pill) => getComputedStyle(pill).backgroundColor,
  );
  expect(hoveredBackground).not.toBe(pressedBackground);
  await page.locator('#diff-generated button[aria-label="Viewed"]').click();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');

  await expectViewedReset(page);
}

async function expectViewedReset(page: Page): Promise<void> {
  const viewed = page.locator('[data-filter-kind="viewed"][data-filter-value="true"]');
  const filters = page.locator('[data-diffseek="filters"]');
  const menu = page.locator('[role="menu"]');
  const ownerRow = page.locator(
    '.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@pull-source"])',
  );
  const ownerOnly = ownerRow.locator('[data-filter-only]');
  await viewed.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#docs\\/readme\\.md')).toBeHidden();
  await viewed.click();
  await expect(viewed).toHaveAttribute(checkedAttribute, 'mixed');
  await expect(
    page.locator(snackbarSelector).last(),
  ).toContainText('Always hidden');
  const reset = page.locator('[data-reset-filters]');
  await expect(reset).toHaveCount(0);
  await ownerRow.hover();
  await ownerOnly.click();
  await expect(
    page.locator(
      '[data-filter-kind="owners"]:not([data-filter-value="@pull-source"])',
    ).first(),
  ).toHaveAttribute(checkedAttribute, 'false');
  await expect(reset).toBeVisible();
  const [buttonRect, rootRect, menuRect] = await Promise.all([
    reset.boundingBox(),
    filters.boundingBox(),
    menu.boundingBox(),
  ]);
  expectMenuGeometry(buttonRect, rootRect, menuRect);
  await reset.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#docs\\/readme\\.md')).toBeHidden();
  await expect(viewed).toHaveAttribute(checkedAttribute, 'mixed');
  await expect(
    page.locator('[data-filter-kind="owners"][aria-checked="false"]'),
  ).toHaveCount(0);
  await expect(reset).toHaveCount(0);
}

