import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';

function presentBox(box: { x: number; y: number; width: number; height: number } | null): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (box == null) throw new Error('Missing DiffSeek menu geometry');
  return box;
}

let context: BrowserContext;
let fixtureSource = '';
const fixturePath = resolve(
  'src/adapters/github/review-page/fixtures/github-pr.html',
);
const markAll = 'Mark all viewed';
const markRest = 'Mark the rest viewed';
const attributesBody = [
  'src/** group=Code',
  'docs/** group=Docs',
  '*.ts linguist-language=TypeScript',
  'src/generated.ts linguist-generated',
].join('\n');
const searchRoute = (url: URL) =>
  url.hostname === 'github.com' && url.pathname === '/search';
const filterDefaultsKey = 'diffseek:filter-defaults';

function searchResponse(paths: string[]) {
  const results = paths.map((path, index) => ({ path, blob_sha: `blob${index}` }));
  return {
    contentType: 'application/json',
    body: JSON.stringify({
      payload: {
        blackbirdSearchRoute: { results, result_count: results.length, page_count: 1, page: 1, errors: [], logged_in: true },
      },
    }),
  };
}

test.beforeAll(async () => {
  fixtureSource = await readFile(fixturePath, 'utf8');
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.route(
    'https://github.com/octo/repo/pull/*/commits',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `{"oid":"${'c'.repeat(40)}"}`,
      });
    },
  );
  await context.route(searchRoute, async (route) => {
    await route.fulfill(searchResponse(['.gitattributes', 'CODEOWNERS']));
  });
  await context.route('https://github.com/octo/repo/raw/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (/\/raw\/[^/]+\/\.gitattributes$/.test(url)) {
      await route.fulfill({
        contentType: 'text/plain',
        body: attributesBody,
      });
    } else if (url.endsWith('/CODEOWNERS') && !url.includes('/.github/')) {
      await route.fulfill({ contentType: 'text/plain', body: 'src/** @source' });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
});

test.beforeEach(async () => {
  await clearExtensionStorage();
  await writeFilterDefaults({ hidden: [], viewed: [] });
});

test.afterEach(async () => {
  await Promise.all(context.pages().map((page) => page.close()));
});

test.afterAll(async () => {
  await context.close();
});

test('replaces the classic review route with the modern experience', async () => {
  const page = await context.newPage();
  for (const url of [
    'https://github.com/octo/repo/pull/8/files',
    'https://github.com/octo/repo/pull/8/changes?new_files_changed=true',
  ]) {
    await page.route(url, async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixtureSource),
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
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-diffseek="snackbar"]')) return;
      requestAnimationFrame(() => {
        document.documentElement.dataset.startSnackbarPainted = 'true';
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest('button');
        if (button?.getAttribute('aria-label') === 'Not Viewed') {
          document.documentElement.dataset.nativeClickAfterSnackbarPaint =
            document.documentElement.dataset.startSnackbarPainted ?? 'false';
        }
      },
      true,
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
      '[data-filter-kind="owners"][data-filter-value="@source"]',
    ),
  ).toBeVisible();
  const finalMenuHeight = await page
    .locator('.diffseek-menu-content')
    .evaluate((content) => ({
      client: content.clientHeight,
      scroll: content.scrollHeight,
    }));
  expect(finalMenuHeight.scroll).toBe(finalMenuHeight.client);
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
  await expect(page.locator('html')).toHaveAttribute(
    'data-toast-log',
    /Marking visible files in folder viewed…/,
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-native-click-after-snackbar-paint',
    'true',
  );
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('#diff-new button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#src [aria-label="Unmark all"]').click();
  await expect(
    page.locator('#diff-app button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  const unmarked = page.locator('[data-diffseek="snackbar"]', {
    hasText: 'Visible files in folder unmarked',
  });
  await expect(unmarked).toBeVisible();
  await unmarked.click();
  await expect(page.locator('[data-diffseek="snackbars"]')).toHaveCount(0);

  await page.evaluate(() => {
    const tree = document.querySelector('[role="tree"]');
    tree?.replaceWith(tree.cloneNode(true));
  });
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
});

test('interleaves native and DiffSeek viewed actions in action order', async () => {
  const page = await openPull(2);
  await page.evaluate(() => {
    document.documentElement.dataset.nativeDelay = '75';
  });

  await markAllViewed(page);
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Visible files in folder marked viewed');
});

test('does not overwrite a later native action with a pending batch path', async () => {
  const page = await openPull(7);
  await page.evaluate(() => {
    document.documentElement.dataset.nativeDelay = '75';
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
    /^Visible files in folder marked viewed$/m,
  );
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('drops a pending viewed result after route navigation', async () => {
  const page = await openPull(3);

  await page.locator(`#src [aria-label="${markAll}"]`).click();
  await page.evaluate(() => {
    history.pushState({}, '', '/octo/repo/issues/3');
    document.body.innerHTML = '<main>Issue route</main>';
  });

  await expect(page.locator('html')).toHaveAttribute(
    'data-native-actions',
    'idle',
  );
  await expect(page.getByText('Issue route', { exact: true })).toBeVisible();
  await expect(page.locator('[data-diffseek="snackbars"]')).toHaveCount(0);
});

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
    '.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@source"])',
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
  expect(new Set(onlyColumns.map(Math.round)).size).toBe(1);
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
      '[data-filter-kind="owners"]:not([data-filter-value="@source"])',
    ).first(),
  ).toHaveAttribute('aria-checked', 'false');
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
  await expect(alwaysRead).toHaveAttribute('aria-pressed', 'false');
  await generated.click();
  await expect(generated).toHaveAttribute('aria-checked', 'false');
  await expect(generated).toHaveAttribute(
    'title',
    '○ Show now\n● Hide now\n○ Always hide',
  );
  await expect(generated).toHaveAttribute(
    'aria-label',
    'Generated: Hide now, click for Always hide',
  );
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Hidden');
  await generated.click();
  await expect(generated).toHaveAttribute('aria-checked', 'mixed');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Always hidden');
  await generated.click();
  await expect(generated).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Shown');
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await generated.locator('xpath=..').hover();
  await alwaysRead.click();
  await expect(alwaysRead).toHaveAttribute('aria-pressed', 'true');
  const pressedBackground = await alwaysRead.evaluate(
    (pill) => getComputedStyle(pill).backgroundColor,
  );
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await alwaysRead.click();
  await expect(alwaysRead).toHaveAttribute('aria-pressed', 'false');
  const hoveredBackground = await alwaysRead.evaluate(
    (pill) => getComputedStyle(pill).backgroundColor,
  );
  expect(hoveredBackground).not.toBe(pressedBackground);
  await page.locator('#diff-generated button[aria-label="Viewed"]').click();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');

  await viewed.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#docs\\/readme\\.md')).toBeHidden();
  await viewed.click();
  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Always hidden');
  const reset = page.locator('[data-diffseek="filters"] [data-reset-filters]');
  // Nothing to reset: nothing shown, and its space stays so rows do not move.
  await expect(reset).toBeHidden();
  const filtersBlock = page.locator('[data-diffseek="filters"]');
  const rowOffset = async () =>
    presentBox(await viewed.boundingBox()).y - presentBox(await filtersBlock.boundingBox()).y;
  const rowOffsetWithoutReset = await rowOffset();
  await ownerRow.hover();
  await ownerOnly.click();
  await expect(
    page.locator(
      '[data-filter-kind="owners"]:not([data-filter-value="@source"])',
    ).first(),
  ).toHaveAttribute('aria-checked', 'false');
  await expect(reset).toBeVisible();
  await expect(reset).toHaveText('Reset filters');
  expect(await rowOffset()).toBe(rowOffsetWithoutReset);
  const [buttonRect, iconRect, labelRect, rootRect, rowRect] = await Promise.all([
    reset.boundingBox(),
    reset.locator('svg').boundingBox(),
    reset.locator('span').boundingBox(),
    page.locator('[data-diffseek="filters"]').boundingBox(),
    viewed.boundingBox(),
  ]);
  const resetButton = presentBox(buttonRect);
  const filtersRoot = presentBox(rootRect);
  const icon = presentBox(iconRect);
  // Where the icon-only control sat: centered 6 px inside the top-right corner.
  const cornerOffset = (a: number, b: number) => Math.abs(a - b) <= 2;
  expect({
    iconAtCorner:
      cornerOffset(icon.x + icon.width / 2, filtersRoot.x + filtersRoot.width - 6) &&
      cornerOffset(icon.y + icon.height / 2, filtersRoot.y + 6),
    labelBeforeIcon: presentBox(labelRect).x < icon.x,
    aboveRows: resetButton.y + resetButton.height <= presentBox(rowRect).y,
  }).toEqual({ iconAtCorner: true, labelBeforeIcon: true, aboveRows: true });
  await reset.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#docs\\/readme\\.md')).toBeHidden();
  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await expect(
    page.locator('[data-filter-kind="owners"][aria-checked="false"]'),
  ).toHaveCount(0);
  await expect(reset).toBeHidden();
});

test('puts Reset filters on the closed filter button while filters hide files', async () => {
  const page = await openPull(14);
  // GitHub's captured button: named by aria-labelledby, anchored by Primer.
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Filter options"]');
    button?.insertAdjacentHTML('beforebegin', '<span id="filter-options-label" hidden>Filter options</span>');
    button?.removeAttribute('aria-label');
    button?.setAttribute('id', 'filter-options');
    button?.setAttribute('aria-haspopup', 'true');
    button?.setAttribute('aria-labelledby', 'filter-options-label');
    button?.setAttribute('style', 'anchor-name: --anchored-overlay-anchor-r1;');
  });
  await page.addStyleTag({
    content: '#filter-options { margin: 40px; width: 32px; height: 32px; }',
  });
  await page.getByLabel('Filter options').click();
  await page.locator('[data-filter-kind="groups"][data-filter-value="Code"]').click();
  await expect(page.locator('#diff-app')).toBeHidden();
  const pill = page.locator('[data-diffseek="filter-button-reset"]');
  await expect(pill).toHaveCount(0);

  await page.evaluate(() => document.querySelector('[role="menu"]')?.remove());
  await expect(pill).toBeVisible();
  const button = presentBox(await page.getByLabel('Filter options').boundingBox());
  const icon = presentBox(await pill.locator('svg').boundingBox());
  const label = presentBox(await pill.locator('span').boundingBox());
  // The same spot as in the menu: the icon 6 px inside the top-right corner.
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  expect({
    iconAtCorner:
      near(icon.x + icon.width / 2, button.x + button.width - 6) &&
      near(icon.y + icon.height / 2, button.y + 6),
    labelBeforeIcon: label.x < icon.x,
  }).toEqual({ iconAtCorner: true, labelBeforeIcon: true });

  await pill.click();
  await expect(page.locator('#diff-app')).toBeVisible();
  await expect(pill).toHaveCount(0);
});

test('scrolls a tall menu in GitHub\'s overlay only, down to its last row', async () => {
  const page = await openPull(15);
  await page.setViewportSize({ width: 1280, height: 240 });
  await page.getByLabel('Filter options').click();
  await expect(page.locator('[data-diffseek="filters"]')).toBeVisible();
  // Primer's overlay: fixed, at most the screen's height, and it scrolls.
  await page.evaluate(() => {
    const menu = document.querySelector('[data-diffseek-menu-owned="true"]');
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.setAttribute('style', 'position: fixed; top: 40px; left: 0; max-height: 100vh; overflow: auto');
    menu?.before(overlay);
    if (menu) overlay.append(menu);
  });
  const size = await page.evaluate(() => {
    const overlay = document.getElementById('overlay');
    const menu = document.querySelector('[data-diffseek-menu-owned="true"]');
    return {
      overlayScrolls: (overlay?.scrollHeight ?? 0) > (overlay?.clientHeight ?? 0),
      menuScrolls: (menu?.scrollHeight ?? 0) > (menu?.clientHeight ?? 0),
    };
  });
  expect(size).toEqual({ overlayScrolls: true, menuScrolls: false });
  const last = page.locator('[data-diffseek="filters"] [data-filter-kind]').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const before = await last.getAttribute('aria-checked');
  await last.click();
  await expect(last).not.toHaveAttribute('aria-checked', before ?? '');
});

test('keeps the pointer inside the row on its way to "only"', async () => {
  const page = await openPull(16);
  await page.getByLabel('Filter options').click();
  const row = page.locator(
    '.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="Docs"])',
  );
  await row.hover();
  const item = presentBox(await row.locator('[data-filter-kind]').boundingBox());
  const only = presentBox(await row.locator('[data-filter-only]').boundingBox());
  const y = only.y + only.height / 2;
  const outside = await page.evaluate(
    ({ from, to, y: line }) => {
      const target = document.querySelector('[data-filter-kind="groups"][data-filter-value="Docs"]');
      const docsRow = target?.closest('.diffseek-menu-row');
      const misses: number[] = [];
      for (let x = from; x <= to; x += 1) {
        if (document.elementFromPoint(x, line)?.closest('.diffseek-menu-row') !== docsRow) misses.push(x);
      }
      return misses;
    },
    { from: Math.round(item.x + item.width / 2), to: Math.round(only.x + only.width / 2), y },
  );
  expect(outside).toEqual([]);
});

test('stays idempotent through a deterministic native-extension action storm', async () => {
  const page = await openPull(4);
  await page.getByLabel('Filter options').click();

  const code = page.locator(
    '[data-filter-kind="groups"][data-filter-value="Code"]',
  );
  const app = page.locator('#diff-app');
  await code.click();
  await expect(app).toBeHidden();
  // GitHub's own collapse toggles stay GitHub's: DiffSeek hides, never clicks.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#diff-app button[aria-label="Collapse file"]')?.click();
  });
  await expect(app.locator('button[aria-label="Expand file"]')).toHaveCount(1);
  await code.click();
  await expect(app).toBeVisible();
  await expect(app.locator('button[aria-label="Expand file"]')).toHaveCount(1);
  await app.locator('button[aria-label="Expand file"]').click();
  await code.click();
  await code.click();
  await expect(app).toBeVisible();
  await expect(app.locator('button[aria-label="Collapse file"]')).toHaveCount(1);

  await page.evaluate(() => {
    const tree = document.querySelector('[role="tree"]');
    tree?.replaceWith(tree.cloneNode(true));
    const menu = document.querySelector('[role="menu"]');
    menu?.replaceWith(menu.cloneNode(true));
  });
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(1);

  await page.evaluate(() => {
    document.documentElement.dataset.nativeDelay = '75';
  });
  await markAllViewed(page);
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(1);
  await expect(page.locator('[data-diffseek-filtered-out]')).toHaveCount(0);
});

test('retains collapsed folders and marks only visible facet files', async () => {
  const page = await openPull(6);
  await page.evaluate(() => {
    const folder = document.getElementById('src');
    const group = document.createElement('ul');
    group.setAttribute('role', 'group');
    for (const path of ['src/app.ts', 'src/new.ts', 'src/generated.ts']) {
      const item = document.getElementById(path);
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
    const folder = document.getElementById('src');
    folder?.setAttribute('aria-expanded', 'false');
    folder?.querySelector('[role="group"]')?.remove();
  });
  await expect(page.locator('#src')).toBeVisible();
  await expect(codeCounter).toHaveText('2/3');

  const codeViewed = page.locator(
    '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Code"]',
  );
  await expect(codeViewed).toHaveAttribute('aria-label', markAll);
  await expect(codeCounter).toHaveAttribute('aria-label', markAll);
  await expect(codeViewed).toHaveAttribute('aria-pressed', 'false');
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
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('#diff-new button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  // The progress toast is replaced in place by the outcome.
  await expect(page.locator('html')).toHaveAttribute(
    'data-toast-log',
    /^Marking all files in category viewed…\nAll files in category marked viewed$/m,
  );
  await expect(page.locator('[data-diffseek="snackbar"]')).toHaveText([
    'All files in category marked viewed',
  ]);

  await page.locator('#diff-app button[aria-label="Viewed"]').click();
  await expect(codeViewed).toHaveAttribute('aria-label', markRest);
  await expect(codeCounter).toHaveAttribute('aria-label', markRest);
  await expect(codeViewed).toHaveAttribute('aria-pressed', 'mixed');
  await expect(codeViewed).toHaveClass(/diffseek-viewed-partial/);
  const eclipse = await codeViewed.evaluate((action) => {
    const before = getComputedStyle(action, '::before');
    const after = getComputedStyle(action, '::after');
    return {
      backgroundImage: before.backgroundImage,
      afterContent: after.content,
    };
  });
  expect(eclipse.backgroundImage).toContain('radial-gradient');
  expect(eclipse.backgroundImage).toContain('36%');
  expect(eclipse.backgroundImage).toContain('2.3px');
  expect(eclipse.afterContent).toBe('none');
  await codeViewed.click();
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .locator('[data-filter-kind="viewed"][data-filter-value="true"]')
    .click();
  await expect(codeCounter).toHaveText('0/3');
  await expect(codeViewed).toHaveAttribute(
    'aria-label',
    'Unmark all',
  );
  await expect(codeCounter).toHaveAttribute(
    'aria-label',
    'Unmark all',
  );
  await codeCounter.click();
  await expect(
    page.locator('#diff-app button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator('#diff-new button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(codeCounter).toHaveText('2/3');
  await expect(codeViewed).toHaveAttribute('aria-label', markAll);
  await expect(codeViewed).toHaveAttribute('aria-pressed', 'false');

  const generatedCircle = page.locator(
    '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"]',
  );
  await expect(generatedCircle).toHaveAttribute(
    'aria-label',
    'Mark all viewed',
  );
  const separated = await generatedCircle.evaluate((circle) => {
    const pill = document.querySelector('[data-diffseek-always-read]');
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
      snackInsideRow: document.querySelector('[data-diffseek="snackbar"]')
        ?.closest('.diffseek-menu-row') != null,
    };
  });
  expect(separated).toEqual({ overlapsPill: false, snackInsideRow: false });
  await generatedCircle.click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeHidden();
  await expect(generatedCircle).toHaveAttribute('aria-pressed', 'true');
  await generatedCircle.click();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
});

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
  const count = (facet: string) =>
    page.locator(
      `.diffseek-menu-row:has([data-filter-kind="${facet}"][data-filter-value="true"]) .diffseek-menu-count`,
    );

  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await expect(generated).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeHidden();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeHidden();
  await expect(page.locator('[role="treeitem"][id="src/app.ts"]')).toBeVisible();
  await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(count('viewed')).toHaveText('0/2');
  await expect(count('generated')).toHaveText('0/1');
  expect(await readStoredFilterDefaults()).toEqual({});

  await writeFilterDefaults({ hidden: ['viewed'], viewed: [] });
  // A reload restores this tab's selection; without one it reads the defaults.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByLabel('Filter options').click();
  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await expect(generated).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeHidden();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeVisible();
  await expect(count('generated')).toHaveText('1/1');

  // The fresh hiding defaults with auto-view switched off.
  await writeFilterDefaults({ hidden: ['viewed', 'generated'], viewed: [] });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByLabel('Filter options').click();
  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await viewed.click();
  await expect(viewed).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeVisible();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeHidden();

  await expect(page.locator('[data-diffseek-always-read]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await generated.click();
  await expect(generated).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeVisible();
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  expect(await readStoredFilterDefaults()).toEqual({
    'diffseek:filter-defaults': { hidden: [], viewed: [] },
  });
});

test('restores review filters on return and starts fresh in a new tab', async () => {
  const pull = 14;
  const page = await openPull(pull);
  const changesUrl = page.url();
  const listUrl = new URL('/octo/repo/pulls', changesUrl).href;
  await page.route(listUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<a href="${changesUrl}">Open pull request</a>`,
    }),
  );
  const docsFilter = '[data-filter-kind="groups"][data-filter-value="Docs"]';
  const docsFile = '[role="treeitem"][id="docs/readme.md"]';
  const filter = page.locator(docsFilter);

  await page.getByLabel('Filter options').click();
  await expect(filter).toHaveAttribute('aria-checked', 'true');
  await filter.click();
  await expect(page.locator(docsFile)).toBeHidden();

  await page.goto(listUrl);
  await page.getByRole('link', { name: 'Open pull request' }).click();
  await expect(page).toHaveURL(changesUrl);
  await page.getByLabel('Filter options').click();
  await expect(filter).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator(docsFile)).toBeHidden();

  const fresh = await openPull(pull);
  await fresh.getByLabel('Filter options').click();
  await expect(fresh.locator(docsFilter)).toHaveAttribute('aria-checked', 'true');
  await expect(fresh.locator(docsFile)).toBeVisible();
});

test('applies a late gitattributes fetch on a fresh store', async () => {
  await writeFilterDefaults(null);
  let releaseAttributes = () => {};
  const attributesReady = new Promise<void>((settle) => {
    releaseAttributes = settle;
  });
  const attributesRoute = 'https://github.com/octo/repo/raw/*/.gitattributes';
  await context.route(attributesRoute, async (route) => {
    await attributesReady;
    await route.fulfill({
      contentType: 'text/plain',
      body: attributesBody,
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
    ).toHaveAttribute('aria-checked', 'mixed');
    await expect(generated).toHaveCount(0);
    await expect(
      page.locator('[role="treeitem"][id="src/generated.ts"]'),
    ).toBeVisible();

    releaseAttributes();
    await expect(generated).toHaveAttribute('aria-checked', 'mixed');
    await expect(
      page.locator('[role="treeitem"][id="src/generated.ts"]'),
    ).toBeHidden();
    expect(await readStoredFilterDefaults()).toEqual({});
  } finally {
    releaseAttributes();
    await context.unroute(attributesRoute);
  }
});

test('hides nested generated files across streamed paths and cached revisits', async () => {
  await writeFilterDefaults({ hidden: ['generated'], viewed: [] });
  const directory = 'apps/contributor/shared/openapi';
  const generatedPath = `${directory}/auth.json`;
  const descendantPath = `${directory}/nested/noauth.json`;
  const manualPath = `${directory}/manual/keep.json`;
  const siblingPath = 'web-apps/packages/manual/spec.json';
  const streamedPath =
    'web-apps/packages/portal-contributor/openapi/contributorPortal/new.json';
  const attributes = new Map([
    [`${directory}/.gitattributes`, '*.json linguist-generated=true'],
    [`${directory}/manual/.gitattributes`, '*.json linguist-generated=false'],
    [
      'web-apps/packages/portal-contributor/openapi/.gitattributes',
      '*.json linguist-generated=true',
    ],
  ]);
  const attributesRoute = 'https://github.com/octo/repo/raw/**/.gitattributes';
  let requests = 0;
  let searches = 0;
  const searchNested = async (route: Route) => {
    searches += 1;
    await route.fulfill(searchResponse([...attributes.keys()]));
  };
  await context.route(searchRoute, searchNested);
  await context.route(attributesRoute, async (route) => {
    requests += 1;
    const path = new URL(route.request().url()).pathname
      .split('/').slice(5).map(decodeURIComponent).join('/');
    const body = attributes.get(path);
    await route.fulfill({
      status: body == null ? 404 : 200,
      contentType: 'text/plain',
      body: body ?? '',
    });
  });
  try {
    const page = await context.newPage();
    const source = fixtureSource
      .replaceAll('src/app.ts', generatedPath)
      .replaceAll('src/new.ts', manualPath)
      .replaceAll('src/generated.ts', descendantPath)
      .replaceAll('docs/readme.md', siblingPath);
    await page.route('https://github.com/octo/repo/pull/430/changes', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(source),
      });
    });
    await page.goto('https://github.com/octo/repo/pull/430/changes');
    await page.getByLabel('Filter options').click();
    const generatedCount = page.locator(
      '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count',
    );
    await expect(generatedCount).toHaveText('0/2');
    await expect(page.locator(`[role="treeitem"][id="${generatedPath}"]`))
      .toHaveAttribute('data-diffseek-filtered-out', 'true');
    await expect(page.locator(`[role="treeitem"][id="${descendantPath}"]`))
      .toHaveAttribute('data-diffseek-filtered-out', 'true');
    await expect(page.locator(`[role="treeitem"][id="${manualPath}"]`))
      .toBeVisible();
    await expect(page.locator(`[role="treeitem"][id="${siblingPath}"]`))
      .toBeVisible();
    await expect(page.locator('[role="treeitem"][id="config/app.json"]'))
      .toBeVisible();

    await page.evaluate((path) => {
      document.querySelector('[role="tree"]')?.insertAdjacentHTML('beforeend', `
        <li id="${path}" role="treeitem" aria-label="new.json">
          <div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-added"></svg></div>
          <a href="#diff-streamed">new.json</a>
        </li>`);
      document.body.insertAdjacentHTML('beforeend', `
        <div id="diff-streamed" role="region">
          <div data-diff-header-wrapper="true">
            <button aria-label="Collapse file"></button>
            <h3><code>${path}</code></h3>
            <button aria-label="Not Viewed" aria-pressed="false">Viewed</button>
          </div>
        </div>`);
    }, streamedPath);
    await expect(generatedCount).toHaveText('0/3');
    await expect(page.locator(`[role="treeitem"][id="${streamedPath}"]`))
      .toHaveAttribute('data-diffseek-filtered-out', 'true');
    await expect(page.locator('#diff-streamed'))
      .toHaveAttribute('data-diffseek-filtered-out', 'true');

    const fetched = requests;
    expect(searches).toBe(1);
    await page.reload();
    await page.getByLabel('Filter options').click();
    await expect(generatedCount).toHaveText('0/2');
    await expect(page.locator(`[role="treeitem"][id="${generatedPath}"]`))
      .toHaveAttribute('data-diffseek-filtered-out', 'true');
    await expect(page.locator(`[role="treeitem"][id="${manualPath}"]`))
      .toBeVisible();
    expect(requests).toBe(fetched);
    expect(searches).toBe(1);
  } finally {
    await context.unroute(searchRoute, searchNested);
    await context.unroute(attributesRoute);
  }
});

test('keeps reconcile passes within budget for cold, warm, and hot loads', async () => {
  await writeFilterDefaults({ hidden: ['viewed', 'generated'], viewed: [] });
  const generatedCount =
    '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count';
  const expectReconcilesWithin = async (
    page: Page,
    scenario: string,
    budget: number,
  ) => {
    await expect(page.locator(generatedCount)).toHaveText('0/1');
    await expect(page.locator('html')).toHaveAttribute(
      'data-diffseek-reconciles',
      /^[1-9]/,
    );
    const reconciles = Number(
      await page.locator('html').getAttribute('data-diffseek-reconciles'),
    );
    test.info().annotations.push({
      type: `fixture-perf:${scenario}`,
      description: `reconciles=${reconciles}`,
    });
    console.log(`diffseek fixture-perf:${scenario} reconciles=${reconciles}`);
    expect(reconciles).toBeLessThanOrEqual(budget);
  };

  const page = await openPull(12);
  await page.getByLabel('Filter options').click();
  await expectReconcilesWithin(page, 'cold', 3);

  await page.reload();
  await page.getByLabel('Filter options').click();
  await expectReconcilesWithin(page, 'warm', 2);

  // GitHub leaves for the conversation tab and puts the same tree and panels back.
  await page.evaluate(async () => {
    const parts = [
      document.querySelector('[role="tree"]'),
      ...document.querySelectorAll('[role="region"][id^="diff-"]'),
    ].filter((part) => part != null);
    const slots = parts.map((part) => [part.parentElement, part.nextSibling] as const);
    const left = new Promise((settle) => {
      document.addEventListener('diffseek-reconciled', settle, { once: true });
    });
    history.pushState({}, '', '/octo/repo/pull/12');
    for (const part of parts) part.remove();
    await left;
    document.dispatchEvent(new Event('diffseek-redraw-reset'));
    history.pushState({}, '', '/octo/repo/pull/12/changes');
    parts.forEach((part, index) => slots[index]?.[0]?.insertBefore(part, slots[index][1]));
  });
  await expectReconcilesWithin(page, 'hot', 1);
});

async function openPull(pull: number, nativeFilter = false): Promise<Page> {
  const page = await context.newPage();
  await page.route(
    `https://github.com/octo/repo/pull/${pull}/changes`,
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixtureSource, nativeFilter),
      });
    },
  );
  await page.goto(`https://github.com/octo/repo/pull/${pull}/changes`);
  return page;
}

async function markAllViewed(page: Page): Promise<void> {
  await page.locator('#diff-app button[aria-label="Not Viewed"]').click();
  await page.locator(`#src [aria-label="${markAll}"]`).click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#diff-app button[aria-label="Viewed"]').click();
  await expect(page.locator(`#src [aria-label="${markRest}"]`)).toBeVisible();
  await page.locator(`#src [aria-label="${markRest}"]`).click();
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function extensionWorker() {
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'))
  );
}

type StoredDefaults = { hidden: string[]; viewed: string[] };

type StorageLocal = {
  clear: () => Promise<void>;
  remove: (name: string) => Promise<void>;
  get: (name: string) => Promise<unknown>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

async function storageLocal() {
  const worker = await extensionWorker();
  return worker.evaluateHandle(
    () =>
      (
        globalThis as unknown as {
          chrome: { storage: { local: StorageLocal } };
        }
      ).chrome.storage.local,
  );
}

async function clearExtensionStorage(): Promise<void> {
  const local = await storageLocal();
  await local.evaluate((storage) => storage.clear());
  await local.dispose();
}

async function removeExtensionStorage(): Promise<void> {
  const local = await storageLocal();
  await local.evaluate(
    (storage, key) => storage.remove(key),
    filterDefaultsKey,
  );
  await local.dispose();
}

async function setExtensionStorage(value: StoredDefaults): Promise<void> {
  const local = await storageLocal();
  await local.evaluate(
    (storage, items) => storage.set(items),
    { [filterDefaultsKey]: value },
  );
  await local.dispose();
}

async function readStoredFilterDefaults(): Promise<unknown> {
  const local = await storageLocal();
  const stored = await local.evaluate(
    (storage, key) => storage.get(key),
    filterDefaultsKey,
  );
  await local.dispose();
  return stored;
}

async function writeFilterDefaults(
  defaults: StoredDefaults | null,
): Promise<void> {
  if (defaults == null) await removeExtensionStorage();
  else await setExtensionStorage(defaults);
}

function instrument(source: string, startsWithNativeFilter = false): string {
  return source
    .replace(
      '<ul role="tree" aria-label="File Tree">',
      `<ul role="tree" aria-label="File Tree">
      <li id="src" role="treeitem" aria-label="src"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div><div>src</div></li>
      <li id="docs" role="treeitem" aria-label="docs"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-directory-fill"></svg></div><div>docs</div></li>`,
    )
    .replace(
      '</body>',
      `${
        startsWithNativeFilter
          ? `<ul role="menu" aria-label="Filter options">
          <li role="none"><button type="button">Clear filters</button></li>
        </ul>`
          : ''
      }
    <script>
      // Every toast text ever shown: toasts are replaced or dismissed by
      // later events, so assertions read the history, not the screen.
      const toastLog = [];
      new MutationObserver(() => {
        for (const toast of document.querySelectorAll('[data-diffseek="snackbar"]')) {
          if (toastLog.at(-1) === toast.textContent) continue;
          toastLog.push(toast.textContent);
          document.documentElement.dataset.toastLog = toastLog.join('\\n');
        }
      }).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      document.documentElement.dataset.nativeActions = 'idle';
      let pendingNativeActions = 0;
      let nativeJsChecked = true;
      const commitNativeAction = (action) => {
        pendingNativeActions += 1;
        document.documentElement.dataset.nativeActions = 'pending';
        setTimeout(() => {
          action();
          pendingNativeActions -= 1;
          if (pendingNativeActions === 0) {
            document.documentElement.dataset.nativeActions = 'idle';
          }
        }, Number(document.documentElement.dataset.nativeDelay ?? 10));
      };
      document.addEventListener('click', (event) => {
        const clearNativeFilters = event.target.closest('button');
        if (clearNativeFilters?.textContent.trim() === 'Clear filters') {
          document.documentElement.dataset.nativeFilterCleared = 'true';
          clearNativeFilters.closest('[role="menu"]')?.remove();
          return;
        }
        const nativeFilter = event.target.closest(
          '[role="menuitemcheckbox"][aria-label=".js"]',
        );
        if (nativeFilter) {
          nativeJsChecked = !nativeJsChecked;
          nativeFilter.setAttribute(
            'aria-checked',
            String(nativeJsChecked),
          );
          nativeFilter.closest('[role="menu"]')?.remove();
          return;
        }
        const button = event.target.closest('button');
        if (!button) return;
        if (button.getAttribute('aria-label') === 'Filter options' || button.id === 'filter-options') {
          if (!document.querySelector('[role="menu"]')) {
            document.body.insertAdjacentHTML(
              'beforeend',
              '<ul role="menu" aria-label="Filter options">' +
                '<li role="menuitemcheckbox" aria-label=".js" aria-checked="' +
                nativeJsChecked +
                '">.js</li>' +
                '<li role="separator">Native separator</li>' +
                '</ul>',
            );
          }
        } else if (button.getAttribute('aria-label') === 'Collapse file') {
          commitNativeAction(() => button.setAttribute('aria-label', 'Expand file'));
        } else if (button.getAttribute('aria-label') === 'Expand file') {
          commitNativeAction(() => button.setAttribute('aria-label', 'Collapse file'));
        } else if (button.getAttribute('aria-label') === 'Not Viewed') {
          commitNativeAction(() => {
            button.setAttribute('aria-label', 'Viewed');
            button.setAttribute('aria-pressed', 'true');
          });
        } else if (button.getAttribute('aria-label') === 'Viewed') {
          commitNativeAction(() => {
            button.setAttribute('aria-label', 'Not Viewed');
            button.setAttribute('aria-pressed', 'false');
          });
        }
      });
    </script></body>`,
    );
}
