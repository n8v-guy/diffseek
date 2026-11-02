import { expect, type Page, test } from '@playwright/test';

import {
  browser,
  closeExtensionPages,
  expectPressedViewed,
  fixtureSource,
  instrument,
  markAll,
  markAllViewed,
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

test('replaces the classic review route with the modern experience', async () => {
  const page = await browser().newPage();
  for (const url of [
    'https://github.com/octo/repo/pull/8/files',
    'https://github.com/octo/repo/pull/8/changes?new_files_changed=true',
  ]) {
    await page.route(url, async (route) => {
      await route.fulfill({
        body: instrument(fixtureSource()),
        contentType: 'text/html',
      });
    });
  }

  await page.goto('https://github.com/octo/repo/pull/8/files');

  await expect(page).toHaveURL(
    'https://github.com/octo/repo/pull/8/changes?new_files_changed=true',
  );
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
});

test('filters, updates folder viewed state, and recovers after a rerender', async () => {
  const page = await openPull(1);

  await page.evaluate(() => {
    const host = globalThis;
    const observer = new host.MutationObserver(() => {
      if (!globalThis.document.querySelector('[data-diffseek="snackbar"]')) return;
      globalThis.requestAnimationFrame(() => {
        const paintedKey = 'startSnackbarPainted';
        globalThis.document.documentElement.dataset[paintedKey] = 'true';
      });
    });
    observer.observe(globalThis.document.body, { childList: true, subtree: true });
    globalThis.document.addEventListener(
      'click',
      (event) => {
        const { Element } = globalThis;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('button');
        if (button?.getAttribute('aria-label') !== 'Not Viewed') return;
        const clickKey = 'nativeClickAfterSnackbarPaint';
        const paintedKey = 'startSnackbarPainted';
        globalThis.document.documentElement.dataset[clickKey] =
          globalThis.document.documentElement.dataset[paintedKey] ?? 'false';
      },
      {capture: true},
    );
  });

  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
  await page.getByLabel('Filter options').click();
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(1);
  const menuSizing = await page.locator('[role="menu"]').evaluate((menu) => {
    const block = menu.querySelector<HTMLElement>(
      '[data-diffseek="filters"]',
    );
    if (!block) throw new Error('Missing DiffSeek menu block');
    const menuRect = menu.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const menuStyle = getComputedStyle(menu);
    const blockStyle = getComputedStyle(block);
    return {
      blockMargin: [
        blockStyle.marginTop,
        blockStyle.marginRight,
        blockStyle.marginBottom,
        blockStyle.marginLeft,
      ],
      horizontalInset: menuRect.width - blockRect.width,
      menuPadding: [
        menuStyle.paddingTop,
        menuStyle.paddingRight,
        menuStyle.paddingBottom,
        menuStyle.paddingLeft,
      ],
      menuWidth: menuRect.width,
      verticalInset: menuRect.height - blockRect.height,
    };
  });
  expect(menuSizing.blockMargin).toEqual(['4px', '4px', '4px', '4px']);
  expect(menuSizing.horizontalInset).toBeCloseTo(8, 0);
  expect(menuSizing.menuPadding).toEqual(['0px', '0px', '0px', '0px']);
  expect(menuSizing.menuWidth).toBeLessThan(500);
  expect(menuSizing.verticalInset).toBeCloseTo(8, 0);
  await expect(
    page.locator(
      '[data-filter-kind="languages"][data-filter-value="TypeScript"]',
    ),
  ).toBeVisible();
  await expect(
    page.locator('[data-filter-kind="generated"][data-filter-value="true"]'),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-filter-kind="owners"][data-filter-value="@pull-source"]',
    ),
  ).toBeVisible();
  const finalMenuHeight = await page
    .locator('.diffseek-menu-content')
    .evaluate((content) => ({
      client: content.clientHeight,
      scroll: content.scrollHeight,
    }));
  expect(finalMenuHeight.scroll).toBe(finalMenuHeight.client);
  await expectFilterChrome(page);
});

async function expectFilterChrome(page: Page): Promise<void> {
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCSS(
    'background-color',
    'rgb(240, 237, 255)',
  );
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCSS(
    'color',
    'rgb(59, 46, 131)',
  );
  const overlayStyle = await page
    .locator('#src [data-diffseek-viewed-action]')
    .evaluate((action) => ({
      anchor: getComputedStyle(action).position,
      badgeBottom: getComputedStyle(action, '::before').bottom,
      badgeHeight: getComputedStyle(action, '::before').height,
      badgeRight: getComputedStyle(action, '::before').right,
      badgeWidth: getComputedStyle(action, '::before').width,
    }));
  expect(overlayStyle).toEqual({
    anchor: 'relative',
    badgeBottom: '-4px',
    badgeHeight: '12px',
    badgeRight: '-4px',
    badgeWidth: '12px',
  });
  const viewedGraphic = await page
    .locator(
      '[role="treeitem"]:has(a[href="#diff-viewed"]) [data-diffseek-viewed-action]',
    )
    .evaluate((action) => ({
      borderBottomWidth: getComputedStyle(action, '::after').borderBottomWidth,
      borderRightWidth: getComputedStyle(action, '::after').borderRightWidth,
      content: getComputedStyle(action, '::after').content,
      height: getComputedStyle(action, '::after').height,
      width: getComputedStyle(action, '::after').width,
    }));
  expect(viewedGraphic).toEqual({
    borderBottomWidth: '2px',
    borderRightWidth: '2px',
    content: '""',
    height: '6px',
    width: '3px',
  });

  await page
    .locator('[data-filter-kind="groups"][data-filter-value="Docs"]')
    .click();
  await expect(
    page.locator('[role="treeitem"][id="docs/readme.md"]'),
  ).toBeHidden();
  await expect(
    page.locator('[role="treeitem"][id="src/app.ts"]'),
  ).toBeVisible();
  await expect(page.locator('#diff-viewed')).toHaveAttribute(
    'data-diffseek-filtered-out',
    'true',
  );

  await page
    .locator('[data-filter-kind="groups"][data-filter-value="Docs"]')
    .click();
  await expect(
    page.locator('[role="treeitem"][id="docs/readme.md"]'),
  ).toBeVisible();

  await page.locator(`#src [aria-label="${markAll}"]`).click();
  await expect(page.locator('[data-diffseek="snackbars"]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await expect(
    page.locator(snackbarSelector, {
      hasText: 'Marking visible files in folder viewed…',
    }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute(
    'data-native-click-after-snackbar-paint',
    'true',
  );
  await expectPressedViewed(page);

  await unmarkVisibleFolder(page);
}

async function unmarkVisibleFolder(page: Page): Promise<void> {
  await page.locator('#src [aria-label="Unmark all"]').click();
  await expect(
    page.locator('#diff-app button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
  const unmarked = page.locator(snackbarSelector, {
    hasText: 'Visible files in folder unmarked',
  });
  await expect(unmarked).toBeVisible();
  await unmarked.click();
  await expect(page.locator('[data-diffseek="snackbars"]')).toHaveCount(0);

  await page.evaluate(() => {
    const tree = globalThis.document.querySelector('[role="tree"]');
    tree?.replaceWith(tree.cloneNode(true));
  });
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
}

test('interleaves native and DiffSeek viewed actions in action order', async () => {
  const page = await openPull(2);
  await page.evaluate(() => {
    const delayKey = 'nativeDelay';
    globalThis.document.documentElement.dataset[delayKey] = '75';
  });

  await markAllViewed(page);
  await expect(
    page.locator(snackbarSelector).last(),
  ).toContainText('Visible files in folder marked viewed');
});

test('does not overwrite a later native action with a pending batch path', async () => {
  const page = await openPull(7);
  await page.evaluate(() => {
    const delayKey = 'nativeDelay';
    globalThis.document.documentElement.dataset[delayKey] = '75';
  });

  await page.locator(`#src [aria-label="${markAll}"]`).click();
  const generated = page.locator(
    '#diff-generated button[aria-label="Not Viewed"]',
  );
  await generated.click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toBeVisible();
  await page.locator('#diff-generated button[aria-label="Viewed"]').click();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toBeVisible();
  // The reviewer's own clicks may already have dismissed the outcome toast.
  await expect(page.locator('html')).toHaveAttribute(
    'data-toast-log',
    /^Visible files in folder marked viewed$/mv,
  );
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute(pressedAttribute, 'false');
});

test('drops a pending viewed result after route navigation', async () => {
  const page = await openPull(3);

  await page.locator(`#src [aria-label="${markAll}"]`).click();
  await page.evaluate(() => {
    globalThis.history.pushState({}, '', '/octo/repo/issues/3');
    const main = globalThis.document.createElement('main');
    main.textContent = 'Issue route';
    globalThis.document.body.replaceChildren(main);
  });

  await expect(page.locator('html')).toHaveAttribute(
    'data-native-actions',
    'idle',
  );
  await expect(page.getByText('Issue route', { exact: true })).toBeVisible();
  await expect(page.locator('[data-diffseek="snackbars"]')).toHaveCount(0);
});

