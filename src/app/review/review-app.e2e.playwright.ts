import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext } from '@playwright/test';

let context: BrowserContext;
const fixturePath = resolve(
  'src/adapters/github/review-page/fixtures/github-pr.html',
);
const srcUnread = 'Mark 3 remaining as viewed (0 of 3 viewed)';
const srcPartial = 'Mark 1 remaining as viewed (2 of 3 viewed)';
const codeUnread = 'Mark 2 remaining as viewed (0 of 2 viewed)';
const codePartial = 'Mark 1 remaining as viewed (1 of 2 viewed)';

test.beforeAll(async () => {
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
  await context.route('https://github.com/octo/repo/raw/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.endsWith('/.gitattributes')) {
      await route.fulfill({
        contentType: 'text/plain',
        body: [
          'src/** group=Code',
          'docs/** group=Docs',
          '*.ts linguist-language=TypeScript',
          'src/generated.ts linguist-generated',
        ].join('\n'),
      });
    } else if (url.endsWith('/CODEOWNERS') && !url.includes('/.github/')) {
      await route.fulfill({
        contentType: 'text/plain',
        body: url.includes(`/raw/${'c'.repeat(40)}/`)
          ? 'src/** @pull-source'
          : 'src/** @source',
      });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
});

test.beforeEach(async () => {
  const worker = await extensionWorker();
  await worker.evaluate(() => {
    const extension = globalThis as unknown as {
      chrome: { storage: { local: { clear: () => Promise<void> } } };
    };
    return extension.chrome.storage.local.clear();
  });
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
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/8/files',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.route(
    'https://github.com/octo/repo/pull/8/changes?new_files_changed=true',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );

  await page.goto('https://github.com/octo/repo/pull/8/files');

  await expect(page).toHaveURL(
    'https://github.com/octo/repo/pull/8/changes?new_files_changed=true',
  );
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
});

test('filters, updates folder viewed state, and recovers after a rerender', async () => {
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/1/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/1/changes');

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

  await page.locator(`#src [aria-label="${srcUnread}"]`).click();
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

  await page.locator('#src [aria-label="Mark as not viewed"]').click();
  await expect(
    page.locator('#diff-app button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');

  await page.evaluate(() => {
    const tree = document.querySelector('[role="tree"]');
    tree?.replaceWith(tree.cloneNode(true));
  });
  await expect(page.locator('[data-diffseek-viewed-action]')).toHaveCount(7);
});

test('interleaves native and DiffSeek viewed actions in action order', async () => {
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/2/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/2/changes');
  await page.evaluate(() => {
    document.documentElement.dataset.nativeDelay = '75';
  });

  await page.locator('#diff-app button[aria-label="Not Viewed"]').click();
  await page.locator(`#src [aria-label="${srcUnread}"]`).click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#diff-app button[aria-label="Viewed"]').click();
  await expect(
    page.locator(`#src [aria-label="${srcPartial}"]`),
  ).toBeVisible();
  await page.locator(`#src [aria-label="${srcPartial}"]`).click();
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Marked 1 file as viewed');
});

test('does not overwrite a later native action with a pending batch path', async () => {
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/7/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/7/changes');
  await page.evaluate(() => {
    document.documentElement.dataset.nativeDelay = '75';
  });

  await page.locator(`#src [aria-label="${srcUnread}"]`).click();
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
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Marked 2 files as viewed');
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('drops a pending viewed result after route navigation', async () => {
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/3/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/3/changes');

  await page.locator(`#src [aria-label="${srcUnread}"]`).click();
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
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/5/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture, true),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/5/changes');
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
      '[data-filter-kind="groups"][data-filter-value="No type"]',
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
  expect(new Set(onlyColumns.map(Math.round)).size).toBe(1);
  await ownerOnly.click();
  await expect(
    page.locator(
      '[data-filter-kind="owners"]:not([data-filter-value="@pull-source"])',
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
  ).toContainText('Hide now');
  await generated.click();
  await expect(generated).toHaveAttribute('aria-checked', 'mixed');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Always hide');
  await generated.click();
  await expect(generated).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Show now');
  await expect(
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await generated.locator('xpath=..').hover();
  await alwaysRead.click();
  await expect(alwaysRead).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await alwaysRead.click();
  await expect(alwaysRead).toHaveAttribute('aria-pressed', 'false');
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
  ).toContainText('Always hide');
  const reset = page.locator('[data-reset-filters]');
  await expect(reset).toHaveCount(0);
  await ownerRow.hover();
  await ownerOnly.click();
  await expect(
    page.locator(
      '[data-filter-kind="owners"]:not([data-filter-value="@pull-source"])',
    ).first(),
  ).toHaveAttribute('aria-checked', 'false');
  await expect(reset).toBeVisible();
  const [buttonRect, rootRect, menuRect] = await Promise.all([
    reset.boundingBox(),
    page.locator('[data-diffseek="filters"]').boundingBox(),
    menu.boundingBox(),
  ]);
  if (!buttonRect || !rootRect || !menuRect) {
    throw new Error('Missing DiffSeek menu geometry');
  }
  const resetGeometry = {
    extendsRight: buttonRect.x + buttonRect.width > rootRect.x + rootRect.width,
    extendsTop: buttonRect.y < rootRect.y,
    insideMenuRight:
      buttonRect.x + buttonRect.width <= menuRect.x + menuRect.width,
    insideMenuTop: buttonRect.y >= menuRect.y,
  };
  expect(resetGeometry).toEqual({
    extendsRight: true,
    extendsTop: true,
    insideMenuRight: true,
    insideMenuTop: true,
  });
  await reset.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#docs\\/readme\\.md')).toBeHidden();
  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await expect(
    page.locator('[data-filter-kind="owners"][aria-checked="false"]'),
  ).toHaveCount(0);
  await expect(reset).toHaveCount(0);
});

test('stays idempotent through a deterministic native-extension action storm', async () => {
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/4/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/4/changes');
  await page.getByLabel('Filter options').click();

  const code = page.locator(
    '[data-filter-kind="groups"][data-filter-value="Code"]',
  );
  await code.click();
  await page.locator('#diff-app button[aria-label="Expand file"]').click();
  await page.waitForTimeout(50);
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
  await page.locator('#diff-app button[aria-label="Not Viewed"]').click();
  await page.locator(`#src [aria-label="${srcUnread}"]`).click();
  await expect(
    page.locator('#diff-generated button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#diff-app button[aria-label="Viewed"]').click();
  await expect(
    page.locator(`#src [aria-label="${srcPartial}"]`),
  ).toBeVisible();
  await page.locator(`#src [aria-label="${srcPartial}"]`).click();
  await expect(
    page.locator('#diff-app button[aria-label="Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-diffseek="filters"]')).toHaveCount(1);
  await expect(page.locator('[data-diffseek-filtered-out]')).toHaveCount(0);
});

test('retains collapsed folders and marks only visible facet files', async () => {
  const page = await context.newPage();
  const fixture = await readFile(
    fixturePath,
    'utf8',
  );
  await page.route(
    'https://github.com/octo/repo/pull/6/changes',
    async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: instrument(fixture),
      });
    },
  );
  await page.goto('https://github.com/octo/repo/pull/6/changes');
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
  await expect(codeViewed).toHaveAttribute('aria-label', codeUnread);
  await expect(codeCounter).toHaveAttribute('aria-label', codeUnread);
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
    page.locator('#diff-generated button[aria-label="Not Viewed"]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator('[data-diffseek="snackbar"]').last(),
  ).toContainText('Marked 2 files as viewed');

  await page.locator('#diff-app button[aria-label="Viewed"]').click();
  await expect(codeViewed).toHaveAttribute('aria-label', codePartial);
  await expect(codeCounter).toHaveAttribute('aria-label', codePartial);
  await expect(codeViewed).toHaveAttribute('aria-pressed', 'mixed');
  await expect(codeViewed).toHaveClass(/diffseek-viewed-partial/);
  expect(
    await codeViewed.evaluate(
      (action) => getComputedStyle(action, '::before').backgroundImage,
    ),
  ).toContain('linear-gradient');
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
    'Mark as not viewed',
  );
  await expect(codeCounter).toHaveAttribute(
    'aria-label',
    'Mark as not viewed',
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
  await expect(codeViewed).toHaveAttribute('aria-label', codeUnread);
  await expect(codeViewed).toHaveAttribute('aria-pressed', 'false');
});

test('hides generated and viewed files for a fresh install and honors saved preferences', async () => {
  await writeFilterDefaults(null);
  const page = await context.newPage();
  const fixture = await readFile(fixturePath, 'utf8');
  await page.route('https://github.com/octo/repo/pull/9/changes', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: instrument(fixture),
    });
  });
  await page.goto('https://github.com/octo/repo/pull/9/changes');
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
  await expect(count('viewed')).toHaveText('0/1');
  await expect(count('generated')).toHaveText('0/1');
  expect(await readStoredFilterDefaults()).toEqual({});

  await writeFilterDefaults({ hidden: ['viewed'], viewed: [] });
  await page.reload();
  await page.getByLabel('Filter options').click();
  await expect(viewed).toHaveAttribute('aria-checked', 'mixed');
  await expect(generated).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[role="treeitem"][id="docs/readme.md"]')).toBeHidden();
  await expect(
    page.locator('[role="treeitem"][id="src/generated.ts"]'),
  ).toBeVisible();
  await expect(count('generated')).toHaveText('1/1');

  await writeFilterDefaults(null);
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

test('applies a late gitattributes fetch on a fresh store', async () => {
  await writeFilterDefaults(null);
  let releaseAttributes = () => {};
  const attributesReady = new Promise<void>((resolve) => {
    releaseAttributes = resolve;
  });
  const attributesRoute = 'https://github.com/octo/repo/raw/**/.gitattributes';
  await context.route(attributesRoute, async (route) => {
    await attributesReady;
    await route.fulfill({
      contentType: 'text/plain',
      body: [
        'src/** group=Code',
        'docs/** group=Docs',
        '*.ts linguist-language=TypeScript',
        'src/generated.ts linguist-generated',
      ].join('\n'),
    });
  });
  try {
    const page = await context.newPage();
    const fixture = await readFile(fixturePath, 'utf8');
    await page.route(
      'https://github.com/octo/repo/pull/10/changes',
      async (route) => {
        await route.fulfill({
          contentType: 'text/html',
          body: instrument(fixture),
        });
      },
    );
    await page.goto('https://github.com/octo/repo/pull/10/changes');
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

async function extensionWorker() {
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'))
  );
}

async function writeFilterDefaults(
  defaults: { hidden: string[]; viewed: string[] } | null,
): Promise<void> {
  const worker = await extensionWorker();
  if (defaults == null) {
    await worker.evaluate(() => {
      const extension = globalThis as unknown as {
        chrome: {
          storage: { local: { remove: (key: string) => Promise<void> } };
        };
      };
      return extension.chrome.storage.local.remove('diffseek:filter-defaults');
    });
    return;
  }
  await worker.evaluate((value) => {
    const extension = globalThis as unknown as {
      chrome: {
        storage: {
          local: { set: (items: Record<string, unknown>) => Promise<void> };
        };
      };
    };
    return extension.chrome.storage.local.set({
      'diffseek:filter-defaults': value,
    });
  }, defaults);
}

async function readStoredFilterDefaults(): Promise<unknown> {
  const worker = await extensionWorker();
  return worker.evaluate(() => {
    const extension = globalThis as unknown as {
      chrome: {
        storage: {
          local: { get: (key: string) => Promise<Record<string, unknown>> };
        };
      };
    };
    return extension.chrome.storage.local.get('diffseek:filter-defaults');
  });
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
        if (button.getAttribute('aria-label') === 'Filter options') {
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
