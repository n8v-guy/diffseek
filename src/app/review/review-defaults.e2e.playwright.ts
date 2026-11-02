import { expect, type Page, test } from '@playwright/test';
import '@diffseek/browser/page-globals';

import {
  attributesBody,
  browser,
  checkedAttribute,
  closeExtensionPages,
  openPull,
  pressedAttribute,
  readStoredFilterDefaults,
  resetExtensionStorage,
  startExtensionBrowser,
  stopExtensionBrowser,
  writeFilterDefaults,
} from './review-e2e.support';

test.beforeAll(startExtensionBrowser);

test.beforeEach(resetExtensionStorage);

test.afterEach(closeExtensionPages);

test.afterAll(stopExtensionBrowser);

test('hides generated and viewed files and auto-views generated for a fresh install, and honors saved preferences', async () => {
  await writeFilterDefaults(null);
  const page = await openPull(9);
  await page.getByLabel('Filter options').click();

  const viewed = page.locator(
    '[data-filter-kind="viewed"][data-filter-value="true"]',
  );
  const generated = page.locator(
    '[data-filter-kind="generated"][data-filter-value="true"]',
  );
  const count = (facet: string): ReturnType<Page['locator']> =>
    page.locator(
      `.diffseek-menu-row:has([data-filter-kind="${facet}"][data-filter-value="true"]) .diffseek-menu-count`,
    );

  await expect(viewed).toHaveAttribute(checkedAttribute, 'mixed');
  await expect(generated).toHaveAttribute(checkedAttribute, 'mixed');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeHidden();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeHidden();
  await expect(page.locator('[role="treeitem"][id="src/app.ts"]')).toBeVisible();
  await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
    pressedAttribute,
    'true',
  );
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'true');
  await expect(count('viewed')).toHaveText('0/2');
  await expect(count('generated')).toHaveText('0/1');
  expect(await readStoredFilterDefaults()).toEqual({});

  await writeFilterDefaults({ hidden: ['viewed'], viewed: [] });
  await page.reload();
  await page.getByLabel('Filter options').click();
  await expect(viewed).toHaveAttribute(checkedAttribute, 'mixed');
  await expect(generated).toHaveAttribute(checkedAttribute, 'true');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeHidden();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeVisible();
  await expect(count('generated')).toHaveText('1/1');

  // The fresh hiding defaults with auto-view switched off.
  await writeFilterDefaults({ hidden: ['viewed', 'generated'], viewed: [] });
  await page.reload();
  await page.getByLabel('Filter options').click();
  await expect(viewed).toHaveAttribute(checkedAttribute, 'mixed');
  await viewed.click();
  await expect(viewed).toHaveAttribute(checkedAttribute, 'true');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeVisible();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeHidden();

  await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
    pressedAttribute,
    'false',
  );
  await generated.click();
  await expect(generated).toHaveAttribute(checkedAttribute, 'true');
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeVisible();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
  expect(await readStoredFilterDefaults()).toEqual({
    'diffseek:filter-defaults': { hidden: [], viewed: [] },
  });
});

test('applies a late gitattributes fetch on a fresh store', async () => {
  await writeFilterDefaults(null);
  const attributesReady = Promise.withResolvers<undefined>();
  const releaseAttributes = (): void => {
    attributesReady.resolve(undefined);
  };
  const attributesRoute = 'https://github.com/octo/repo/raw/**/.gitattributes';
  await browser().route(attributesRoute, async (route) => {
    await attributesReady.promise;
    await route.fulfill({
      body: attributesBody,
      contentType: 'text/plain',
    });
  });
  try {
    const page = await openPull(10);
    await page.getByLabel('Filter options').click();
    const generated = page.locator(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    );
    await expect(
      page.locator('[data-filter-kind="viewed"][data-filter-value="true"]'),
    ).toHaveAttribute(checkedAttribute, 'mixed');
    await expect(generated).toHaveCount(0);
    await expect(
      page.locator('[role="treeitem"][id="src/generated.ts"]'),
    ).toBeVisible();

    releaseAttributes();
    await expect(generated).toHaveAttribute(checkedAttribute, 'mixed');
    await expect(
      page.locator('[role="treeitem"][id="src/generated.ts"]'),
    ).toBeHidden();
    expect(await readStoredFilterDefaults()).toEqual({});
  } finally {
    releaseAttributes();
    await browser().unroute(attributesRoute);
  }
});

