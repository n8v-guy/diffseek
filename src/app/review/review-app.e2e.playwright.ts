import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

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
const filterDefaultsKey = 'diffseek:filter-defaults';

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
  await context.route('https://github.com/octo/repo/raw/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.endsWith('/.gitattributes')) {
      await route.fulfill({
        contentType: 'text/plain',
        body: attributesBody,
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

  await page.locator(`#src [aria-label="${markAll}"]`).click();
  await expect(page.locator('[data-diffseek="snackbars"]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await expect(
    page.locator('[data-diffseek="snackbar"]', {
      hasText: 'Marking visible files in folder viewed…',
    }),
  ).toBeVisible();
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
  const page = await openPull(4);
  await page.getByLabel('Filter options').click();

  const code = page.locator(
    '[data-filter-kind="groups"][data-filter-value="Code"]',
  );
  await code.click();
  // Resolve on the events themselves: GitHub expands the file, then DiffSeek
  // collapses it again.
  await page.evaluate(() => {
    (window as unknown as { recollapsed: Promise<void> }).recollapsed = new Promise((resolve) => {
      let expanded = false;
      const observer = new MutationObserver(() => {
        const label = document.querySelector('#diff-app button')?.getAttribute('aria-label');
        if (label === 'Collapse file') expanded = true;
        else if (expanded && label === 'Expand file') {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.getElementById('diff-app')!, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label'],
      });
    });
  });
  await page.locator('#diff-app button[aria-label="Expand file"]').click();
  await page.evaluate(() => (window as unknown as { recollapsed: Promise<void> }).recollapsed);
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
