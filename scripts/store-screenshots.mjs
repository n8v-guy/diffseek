/**
 * Store screenshots for https://github.com/sha-tm/diffseek-test-data/pull/2.
 *
 *   pnpm build
 *   STORAGE_STATE=/path/to/state.json node scripts/store-screenshots.mjs
 *
 * STORAGE_STATE is a Playwright storage-state JSON file. The script never
 * prints it. Each shot uses a fresh Chromium profile with the built extension.
 * Shots 2-4 turn auto-view off in that profile first, so the PR stays at its
 * 12/82 baseline. Viewed checkboxes live on GitHub, so shots that change them
 * restore the baseline before the browser closes.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const prUrl = 'https://github.com/sha-tm/diffseek-test-data/pull/2';
const changesUrl = `${prUrl}/changes?new_files_changed=true`;
const compareUrl = 'https://github.com/sha-tm/diffseek-test-data/compare/7cf6ff089a...showcase/acme-base';
// Lines kept on GitHub's compare page; the rest of each file is folded away.
const sourceLines = {
  CODEOWNERS: [9, 10, 11],
  '.gitattributes': [3, 4, 5, 6, 7, 19, 20, 21, 22, 23, 25, 26, 27],
};
// Filter defaults with auto-view off, so a fresh profile leaves the PR's
// viewed state alone. Shot 1 skips this and shows the real first run.
const quietDefaults = { hidden: ['viewed', 'generated'], viewed: [] };

const scale = 1.5;
const viewport = { width: 1080, height: 1000 };
const outWidth = 1280;
const outHeight = 800;
// Callout color for annotated shots.
const accent = '#d9480f';
const clipWidth = outWidth / scale;
const clipHeight = outHeight / scale;
const extensionPath = resolve(process.env.EXTENSION_PATH ?? '.output/chrome-mv3');
const shotDir = resolve(process.env.SHOT_DIR ?? 'screenshots/store');
const baseline = [
  'web/src/app/App.tsx',
  'web/src/app/routes.tsx',
  'web/src/checkout/CheckoutPage.tsx',
  'web/src/checkout/PaymentStep.tsx',
  'web/src/checkout/hooks/useCheckout.ts',
  'web/src/components/layout/CheckoutLayout.tsx',
  'web/src/components/ui/Modal.tsx',
  'web/src/lib/analytics.ts',
  'web/src/types/checkout.ts',
  'web/src/types/order.ts',
  'web/config/app.yaml',
  'web/config/routes.yaml',
];

const shots = [
  ['01-noise-cut.png', 'Hidden by default, and generated files viewed for you.'],
  ['02-only.png', 'Before and after “only”: the tree keeps what is left.'],
  ['03-viewed-badges.png', 'Tree badges and menu badges.'],
  ['04-sources.png', 'Categories come from CODEOWNERS and .gitattributes.'],
];

const storageState = process.env.STORAGE_STATE;
if (!storageState) {
  console.error('Set STORAGE_STATE to a Playwright storage state JSON path.');
  process.exit(1);
}

await mkdir(shotDir, { recursive: true });
console.log('Shots land in', shotDir);
for (const [file, caption] of shots) console.log(`${file} — ${caption}`);

const pick = new Set((process.env.SHOTS ?? '1,2,3,4').split(',').map((part) => part.trim()));
if (pick.has('1')) {
  await withPage(async (page) => {
    try {
      await noiseCut(page);
    } finally {
      // Turn auto-view off first, or the restore's reload marks the generated files again.
      await quietProfile(page);
      await restoreBaseline(page);
    }
  }, null);
}
if (pick.has('2')) {
  await withPage(async (page) => {
    await onlySplit(page);
  });
}
if (pick.has('3')) {
  await withPage(async (page) => {
    try {
      await viewedBadges(page);
    } finally {
      await restoreBaseline(page);
    }
  });
}
if (pick.has('4')) {
  await withPage(async (page) => {
    await sourcesSplit(page);
  });
}

async function withPage(run, defaults = quietDefaults) {
  const userData = await mkdtemp(join(tmpdir(), 'diffseek-shot-'));
  const context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: process.env.HEADLESS !== '0',
    viewport,
    deviceScaleFactor: scale,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    // Persistent contexts ignore the storageState option, so load the cookies by hand.
    const { cookies = [] } = JSON.parse(await readFile(storageState, 'utf8'));
    await context.addCookies(cookies);
    if (defaults) {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await worker.evaluate((value) => chrome.storage.local.set({ 'diffseek:filter-defaults': value }), defaults);
    }
    const page = context.pages()[0] ?? (await context.newPage());
    await openReview(page);
    await run(page).catch(async (error) => {
      await page.screenshot({ path: join(shotDir, 'debug-failure.png') }).catch(() => undefined);
      throw error;
    });
  } finally {
    await context.close();
    await rm(userData, { recursive: true, force: true });
  }
}

async function openReview(page) {
  // GitHub sometimes stalls a load of this large PR; one more try clears it.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(changesUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.locator('[data-diffseek-viewed-action]').first().waitFor({ timeout: 60_000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
      console.log('Review page did not load, retrying.');
    }
  }
  await waitForToasts(page);
}

async function noiseCut(page) {
  // The real first run: Viewed and Generated hidden, auto-view on, so the
  // generated files are marked viewed as soon as the PR loads.
  await settleCounts(page, 58);
  await expectCounter(page, 58);
  await waitForQuiet(page);
  const row = page.locator('.diffseek-menu-row:has([data-filter-kind="generated"])');
  const pill = row.locator('[data-diffseek-always-read]');
  if ((await pill.getAttribute('aria-pressed')) !== 'true') throw new Error('auto-view is not on for a fresh install');
  const clip = await frame(page, [filesTab(page), await counter(page, 58), pill], clipWidth, clipHeight);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await waitForQuiet(page);
  const signs = await signBox(page, ['viewed', 'generated'], clip);
  const pillBox = await outBox(pill, clip, 0, 0);
  const menuBox = await outBox(page.locator('[data-diffseek="filters"]'), clip, 0, 0);
  const shot = await shoot(page, clip);
  const center = signs.x + signs.w / 2;
  await compose('01-noise-cut.png', {
    layers: [{ shot, left: 0, width: outWidth, crop: 0 }],
    tags: [],
    notes: [
      { target: signs, shape: 'rect', at: [Math.round(center - 125), Math.round(signs.y - 132)], width: 250, title: 'Hidden by default', sub: '“−” means these files are hidden. Click to show them.' },
      { target: pillBox, shape: 'rect', at: [Math.round(menuBox.x + menuBox.w + 36), Math.round(pillBox.y + 56)], width: 270, title: 'auto-view', sub: 'generated files are marked viewed automatically' },
    ],
  });
}

/** Output box around the "−" / "✓" signs (a ::before) on the given facet rows. */
async function signBox(page, kinds, clip) {
  await page.evaluate(() => document.fonts.ready);
  const boxes = [];
  for (const kind of kinds) {
    const item = page.locator(`[data-filter-kind="${kind}"][data-filter-value="true"]`);
    const box = await item.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.querySelector('span')?.getBoundingClientRect() ?? rect;
      const sign = getComputedStyle(element, '::before');
      const left = rect.left + (Number.parseFloat(getComputedStyle(element).paddingLeft) || 0);
      // The sign's box is wider than the glyph and left-aligned, so measure
      // the glyph's own ink in the sign's font.
      const context = document.createElement('canvas').getContext('2d');
      context.font = sign.font;
      const ink = context.measureText(sign.content.replace(/^["']|["']$/g, ''));
      return { x: left - ink.actualBoundingBoxLeft, y: label.top, width: ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight, height: label.height };
    });
    boxes.push(await outBox(box, clip, 0, 0));
  }
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  };
}

/** Before and after "only" on the payments owner, at the 12/82 baseline. */
async function onlySplit(page) {
  await settleCounts(page);
  const row = await paymentsRow(page);
  const only = row.locator('.diffseek-menu-only');
  const menu = page.locator('[data-diffseek="filters"]');
  const button = page.getByRole('button', { name: 'Filter options' }).filter({ visible: true }).first();
  // Frame from the filter button down, so GitHub's "N / 82 viewed" stays out.
  const subjects = [button, menu.locator('[data-filter-kind="generated"]'), webRow(page)];
  const beforeClip = await frame(page, subjects, clipWidth, clipHeight, 4);
  await row.hover();
  await cursorOn(page, only, false);
  const beforeCrop = halfCrop(await menu.boundingBox(), beforeClip);
  const onlyBox = await outBox(only, beforeClip, beforeCrop, 0);
  const beforeShot = await shoot(page, beforeClip);

  await only.click();
  await waitForToasts(page);
  await openMenu(page);
  await page.mouse.move(2, 2);
  const afterClip = await frame(page, subjects, clipWidth, clipHeight, 4);
  // "all" only shows while its section title is hovered.
  const ownersTitle = page.locator('.diffseek-menu-section:has([data-filter-kind="owners"]) .diffseek-menu-section-title');
  const ownersAll = ownersTitle.locator('[data-filter-all]');
  await ownersTitle.hover();
  await cursorOn(page, ownersAll, false);
  await page.waitForTimeout(300);
  const afterCrop = halfCrop(await menu.boundingBox(), afterClip);
  const allBox = await outBox(ownersAll, afterClip, afterCrop, 640);
  const afterShot = await shoot(page, afterClip);
  await compose('02-only.png', {
    layers: [
      { shot: beforeShot, left: 0, width: 640, crop: beforeCrop },
      { shot: afterShot, left: 640, width: 640, crop: afterCrop },
    ],
    tags: [
      { x: 320, y: 10, text: 'Before', size: 25.5, center: true },
      { x: 960, y: 10, text: 'After “only”', size: 25.5, center: true },
    ],
    notes: [
      { target: onlyBox, shape: 'rect', at: [440, Math.round(onlyBox.y + 70)], width: 186, title: '“only” singles out', sub: 'this category' },
      { target: allBox, shape: 'rect', at: [1080, Math.round(allBox.y + 70)], width: 186, title: '“all” resets', sub: 'back to all the categories' },
    ],
  });
}

/**
 * Left: GitHub's own compare view of the base branch against its
 * README-only first commit, where CODEOWNERS and .gitattributes show as
 * added files. Right: the DiffSeek menu on the PR. Labels sit beside the
 * source lines, with arrows to the menu rows they feed.
 */
async function sourcesSplit(page) {
  await settleCounts(page);
  const menu = page.locator('[data-diffseek="filters"]');
  const rowOf = (kind, value) => menu.locator(`.diffseek-menu-row:has([data-filter-kind="${kind}"][data-filter-value="${value}"])`);
  const rows = {
    generated: rowOf('generated', 'true'),
    payments: await paymentsRow(page),
    tests: rowOf('groups', 'Tests'),
    typescript: rowOf('languages', 'TypeScript'),
  };
  const menuClip = await frame(page, [menu.locator('[data-filter-kind="viewed"]'), rows.typescript], clipWidth, clipHeight);
  await page.mouse.move(2, 2);
  // The menu keeps a 430px strip on the right; the labels sit between it
  // and the source lines.
  const menuLeft = outWidth - 430;
  const menuBox = await menu.boundingBox();
  const menuCrop = Math.round((menuBox.x - menuClip.x) * scale - 16);
  const menuRows = {};
  for (const [key, row] of Object.entries(rows)) menuRows[key] = await outBox(row, menuClip, menuCrop, menuLeft);
  const menuShot = await shoot(page, menuClip);

  await page.goto(compareUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const entry = (path) => page.locator(`copilot-diff-entry[data-file-path="${path}"]`);
  await entry('CODEOWNERS').locator('td[data-line-number]').first().waitFor({ timeout: 60_000 });
  await entry('.gitattributes').locator('td[data-line-number]').first().waitFor({ timeout: 60_000 });
  await page.evaluate((keep) => {
    for (const [path, lines] of Object.entries(keep)) {
      const file = document.querySelector(`copilot-diff-entry[data-file-path="${path}"]`);
      for (const row of file?.querySelectorAll('tr') ?? []) {
        const numbers = [...row.querySelectorAll('td[data-line-number]')].map((cell) => Number(cell.getAttribute('data-line-number')));
        if (numbers.length > 0 && !numbers.some((number) => lines.includes(number))) row.style.display = 'none';
      }
    }
    // Show only these two files, and drop the banner GitHub adds because the
    // demo @acme teams do not exist on this account. A style rule also
    // catches files and banners that GitHub streams in later.
    const kept = Object.keys(keep);
    const style = document.createElement('style');
    style.textContent = `${kept.reduce((rule, path) => `${rule}:not([data-file-path="${path}"])`, 'copilot-diff-entry')}{display:none!important}.js-codeowners-errors,footer{display:none!important}`;
    document.head.append(style);
    // Added files have no old-side line numbers; fold that empty column.
    for (const path of kept) {
      const file = document.querySelector(`copilot-diff-entry[data-file-path="${path}"]`);
      for (const row of file?.querySelectorAll('tr') ?? []) {
        const first = row.querySelector('td');
        if (first && /blob-num/.test(first.className) && row.querySelectorAll('td[class*="blob-num"]').length === 2) first.style.display = 'none';
      }
      for (const col of file?.querySelectorAll('colgroup col:first-child') ?? []) col.style.display = 'none';
    }
    for (const node of document.querySelectorAll('copilot-diff-entry[data-file-path="CODEOWNERS"] *')) {
      if (node.children.length < 4 && /contains errors/.test(node.textContent ?? '') && !node.closest('table')) {
        const block = node.closest('.js-file-content > div, .js-file-content > *') ?? node;
        if (!block.querySelector('table')) block.style.display = 'none';
      }
    }
    // GitHub lists .gitattributes first; put CODEOWNERS on top.
    const owners = document.querySelector('copilot-diff-entry[data-file-path="CODEOWNERS"]');
    const attributes = document.querySelector('copilot-diff-entry[data-file-path=".gitattributes"]');
    let a = owners;
    let b = attributes;
    while (a && b && a.parentElement !== b.parentElement) {
      if (a.parentElement?.contains(b)) b = b.parentElement;
      else a = a.parentElement;
    }
    if (a && b) a.parentElement.insertBefore(a, b);
  }, sourceLines);
  const lineRows = (path, numbers) => page.evaluate(({ path, numbers }) => {
    const file = document.querySelector(`copilot-diff-entry[data-file-path="${path}"]`);
    const rows = [...(file?.querySelectorAll('tr') ?? [])].filter((row) =>
      [...row.querySelectorAll('td[data-line-number]')].some((cell) => numbers.includes(Number(cell.getAttribute('data-line-number')))),
    );
    // Measure the code text itself, not the full-width row.
    const boxes = rows.map((row) => {
      const code = row.querySelector('.blob-code-inner') ?? row.lastElementChild;
      const range = document.createRange();
      range.selectNodeContents(code);
      const text = range.getBoundingClientRect();
      const cell = row.getBoundingClientRect();
      return { left: text.left - 4, right: text.right + 4, top: cell.top, bottom: cell.bottom };
    });
    const text = rows.map((row) => row.innerText.replace(/\s+/g, ' ').trim());
    const x = Math.min(...boxes.map((box) => box.left));
    const y = Math.min(...boxes.map((box) => box.top));
    return { x, y, width: Math.max(...boxes.map((box) => box.right)) - x, height: Math.max(...boxes.map((box) => box.bottom)) - y, text };
  }, { path, numbers });
  const owners = entry('CODEOWNERS');
  await owners.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -12));
  await settleLayout(page);
  const top = await owners.boundingBox();
  const sourceClip = { x: top.x - 4, y: top.y - 10, width: clipWidth, height: clipHeight };
  const lines = {
    payments: await lineRows('CODEOWNERS', [10, 11]),
    generated: await lineRows('.gitattributes', [4, 5, 6, 7]),
    tests: await lineRows('.gitattributes', [20, 21, 22, 23]),
    typescript: await lineRows('.gitattributes', [26, 27]),
  };
  console.log('sources:', JSON.stringify(Object.fromEntries(Object.entries(lines).map(([key, value]) => [key, value.text]))));
  const source = {};
  for (const [key, box] of Object.entries(lines)) {
    // Highlight the code text, not the full-width row.
    const out = await outBox(box, sourceClip, 0, 0);
    source[key] = { ...out, w: Math.min(out.w, menuLeft - 220 - out.x) };
  }
  const sourceShot = await shoot(page, sourceClip);
  const labelLeft = menuLeft - 198;
  const note = (key, title, sub) => ({
    target: menuRows[key],
    arrow: true,
    target2: source[key],
    shape: 'rect',
    at: [labelLeft, Math.round(source[key].y + source[key].h / 2 - 30)],
    width: 186,
    title,
    sub,
  });
  await compose('04-sources.png', {
    layers: [
      { shot: sourceShot, left: 0, width: menuLeft, crop: 0 },
      { shot: menuShot, left: menuLeft, width: outWidth - menuLeft, crop: menuCrop },
    ],
    tags: [
      { x: Math.round((menuLeft - 210) / 2), y: 742, text: 'Repository files', center: true },
      { x: Math.round(menuLeft + 215), y: 742, text: 'DiffSeek menu', center: true },
    ],
    notes: [
      note('payments', 'Owner: payments', '@acme/payments in CODEOWNERS'),
      note('generated', 'Generated', 'linguist-generated in .gitattributes'),
      note('tests', 'Group: Tests', 'group=Tests in .gitattributes'),
      note('typescript', 'Format: TypeScript', 'linguist-language in .gitattributes'),
    ],
  });
}

function webRow(page) {
  return page.locator('.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@acme/web-platform"])');
}

/**
 * Tree and menu badges at the 12/82 baseline, with a real menu toast in its
 * own top-right spot. The payments row is marked and then unmarked from the
 * menu, which leaves the baseline as it was; the second toast is the one in
 * the shot. That toast node is copied in place so it outlives its 7s timer
 * while GitHub settles. The shot shows the full viewport width, so it runs
 * at a lower zoom than the others.
 */
async function viewedBadges(page) {
  await settleCounts(page);
  await closeMenu(page);
  await expandTo(page, 'web');
  // Fold the other top-level folders so web sits under the tab bar.
  const others = await page.evaluate(() =>
    [...document.querySelectorAll('[role="treeitem"][aria-expanded="true"]')]
      .filter((node) => node.id !== 'web' && !node.id.startsWith('web/'))
      .filter((node) => !node.parentElement?.closest('[role="treeitem"][aria-expanded="true"]:not([id="web"])'))
      .map((node) => node.id),
  );
  for (const id of others) {
    // An open folder's box covers its children, so click its own chevron.
    await page.locator(`[role="treeitem"][id="${id}"] > div .PRIVATE_TreeView-item-toggle`).first().click();
    await page.waitForTimeout(200);
  }
  const folder = page.locator('[role="treeitem"][id="web"]');
  const action = await ownAction(folder);
  if ((await action.getAttribute('aria-pressed')) !== 'mixed') {
    throw new Error(`web folder circle is ${await action.getAttribute('aria-pressed')}, expected mixed at the 12/82 baseline`);
  }
  await openMenu(page);
  const paymentsMark = () => paymentsRow(page).then((row) => row.locator('[data-diffseek-menu-viewed-action]'));
  await (await paymentsMark()).click();
  console.log('menu toast:', await waitForToast(page, /^Marked all \d+ payments files viewed/, 60_000));
  await expectCounter(page, 50);
  await waitForToasts(page);
  await openMenu(page);
  await (await paymentsMark()).click();
  const unmarked = /^Unmarked all \d+ payments files/;
  const toast = await waitForToast(page, unmarked, 60_000);
  await holdToast(page, unmarked);
  console.log('menu toast:', toast);
  await expectCounter(page, 12);
  await openMenu(page);
  await page.waitForFunction(() => {
    const row = document.querySelector('.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@acme/payments"])');
    return row?.querySelector('[data-diffseek-menu-viewed-action]')?.getAttribute('aria-pressed') === 'false';
  }, undefined, { timeout: 30_000 });
  if ((await (await ownAction(folder)).getAttribute('aria-pressed')) !== 'mixed') throw new Error('web folder left the baseline');
  const zoom = 1.2;
  const width = outWidth / zoom;
  await filesTab(page).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settleLayout(page);
  const size = page.viewportSize() ?? viewport;
  const clip = { x: size.width - width, y: 0, width, height: outHeight / zoom, zoom };
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  const web = webRow(page).locator('[data-diffseek-menu-viewed-action]');
  const boxes = {
    folder: await outBox(await discOf(await ownAction(folder)), clip, 0, 0),
    circle: await outBox(await discOf(web), clip, 0, 0),
    menu: await outBox(page.locator('[data-diffseek="filters"]'), clip, 0, 0),
  };
  console.log('badges:', await (await ownAction(folder)).getAttribute('title'), '|', await web.getAttribute('title'));
  const shot = await shoot(page, clip);
  await page.evaluate(() => {
    document.querySelector('[data-shot-hold]')?.remove();
    document.querySelector('[data-diffseek="snackbars"]')?.style.removeProperty('visibility');
  });
  await compose('03-viewed-badges.png', {
    layers: [{ shot, left: 0, width: outWidth, crop: 0 }],
    tags: [],
    notes: [
      { target: boxes.folder, shape: 'ring', at: [Math.round(boxes.folder.x + 90), Math.round(boxes.folder.y - 34)], width: 290, title: 'File tree badge', lines: ['viewed status of <strong>shown</strong> files', '○ none  ◐ some  ● all'] },
      { target: boxes.circle, shape: 'ring', at: [Math.round(boxes.menu.x + boxes.menu.w + 34), Math.round(boxes.circle.y + 20)], width: 270, title: 'Menu category badge', lines: ['viewed status of <strong>all</strong> category files'] },
    ],
  });
}

/** Copy the snackbar stack holding the matching toast so it stays put after its timer. */
async function holdToast(page, pattern) {
  await page.evaluate((source) => {
    const stack = document.querySelector('[data-diffseek="snackbars"]');
    if (!stack) throw new Error('No snackbar on screen');
    const copy = stack.cloneNode(true);
    copy.setAttribute('data-shot-hold', '');
    const keep = new RegExp(source);
    for (const toast of copy.querySelectorAll('[data-diffseek="snackbar"]')) {
      if (!keep.test(toast.textContent ?? '')) toast.remove();
    }
    stack.after(copy);
    stack.style.visibility = 'hidden';
  }, pattern.source);
}

async function quietProfile(page) {
  if (page.isClosed()) return;
  const context = page.context();
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate((value) => chrome.storage.local.set({ 'diffseek:filter-defaults': value }), quietDefaults);
  await openReview(page);
}

/** Wait until no snackbar has been up for two seconds. */
async function waitForQuiet(page) {
  const deadline = Date.now() + 90_000;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if ((await page.locator('[data-diffseek="snackbar"]').count()) > 0) quietSince = Date.now();
    else if (Date.now() - quietSince > 2_000) return;
    await page.waitForTimeout(200);
  }
  throw new Error('DiffSeek toasts did not clear');
}

async function restoreBaseline(page, attempt = 1) {
  if (page.isClosed()) return;
  await openMenu(page).catch(() => undefined);
  const pill = page.locator('[data-diffseek-always-read]');
  if ((await pill.count()) > 0 && (await pill.getAttribute('aria-pressed')) === 'true') {
    await pill.click();
    await waitForToasts(page);
  }
  await showFacet(page, 'viewed');
  await showFacet(page, 'generated');
  await showAllSections(page);
  // A menu row marks its whole category, so one click on the Viewed row
  // clears every viewed file before the baseline files go back on.
  const clearAll = page.locator(
    '[data-diffseek-menu-viewed-action][data-viewed-facet="viewed"][data-viewed-value="true"]',
  );
  if ((await clearAll.count()) > 0 && (await clearAll.getAttribute('aria-label')) === 'Mark as not viewed') {
    await clearAll.click({ force: true });
    await waitForToasts(page);
    await hasCounter(page, 0);
  }
  await closeMenu(page);
  const ids = await collectFileIds(page);
  const missing = baseline.filter((path) => !ids.includes(path));
  if (missing.length > 0) {
    throw new Error(`Baseline files not in the tree: ${missing.join(', ')}`);
  }
  for (const id of baseline) {
    await setFileViewed(page, id, true);
  }
  await waitForToasts(page);
  await expectCounter(page, 12);
  // GitHub saves viewed marks in the background. Reload to prove they stuck
  // before the browser closes, and go again if the server still disagrees.
  await page.waitForTimeout(5_000);
  await openReview(page);
  if (!(await hasCounter(page, 12))) {
    if (attempt >= 3) throw new Error('Baseline did not stick after 3 tries');
    console.log('Baseline did not stick, restoring again.');
    await restoreBaseline(page, attempt + 1);
    return;
  }
  console.log('Baseline restored: 12/82 viewed.');
}

async function hasCounter(page, count) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await counter(page, count).then(() => true, () => false)) return true;
    await page.waitForTimeout(1_000);
  }
  return false;
}

/** GitHub streams the file list in; wait until the menu badges stop changing. */
async function settleCounts(page, viewed = 12) {
  await openMenu(page);
  await page.locator('[data-filter-kind="generated"]').waitFor({ timeout: 60_000 });
  let last = '';
  let steady = 0;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && steady < 6) {
    const text = await page.evaluate(() =>
      [...document.querySelectorAll('[data-diffseek="filters"] .diffseek-menu-count')].map((node) => node.textContent).join(' '),
    );
    const complete = /\/46\b/.test(text) && new RegExp(`/${viewed}\\b`).test(text);
    steady = text === last && complete ? steady + 1 : 0;
    last = text;
    await page.waitForTimeout(500);
  }
  if (steady < 6) throw new Error(`Menu counts never settled: ${last}`);
}

async function showAllSections(page) {
  await openMenu(page);
  const count = await page.locator('[data-diffseek="filters"] [data-filter-all]').count();
  for (let index = 0; index < count; index += 1) {
    await openMenu(page);
    await page.evaluate((at) => {
      const actions = document.querySelectorAll('[data-diffseek="filters"] [data-filter-all]');
      actions[at]?.click();
    }, index);
    await page.waitForTimeout(400);
  }
  await waitForToasts(page);
}

async function showFacet(page, kind) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openMenu(page);
    const row = page.locator(`[data-filter-kind="${kind}"][data-filter-value="true"]`);
    await row.waitFor({ timeout: 30_000 });
    if ((await row.getAttribute('aria-checked')) === 'true') return;
    await row.click();
    await waitForToasts(page);
  }
  throw new Error(`Could not show ${kind} files`);
}

async function setFileViewed(page, id, viewed) {
  const row = page.locator(`[role="treeitem"][id="${id}"]`);
  if ((await row.count()) === 0) {
    await page.evaluate((path) => document.getElementById(path)?.scrollIntoView({ block: 'center' }), id);
  }
  await row.scrollIntoViewIfNeeded().catch(() => undefined);
  const action = await ownAction(row);
  const pressed = await action.getAttribute('aria-pressed');
  if ((pressed === 'true') === viewed) return;
  await action.click();
  await page.waitForFunction(({ path, next }) => {
    const item = document.getElementById(path);
    const anchor = [...(item?.querySelectorAll('[data-diffseek-viewed-action]') ?? [])].find(
      (node) => node.closest('[role="treeitem"]') === item,
    );
    return anchor?.getAttribute('aria-pressed') === (next ? 'true' : 'false');
  }, { path: id, next: viewed }, { timeout: 8_000 });
}

async function collectFileIds(page) {
  await expandAll(page);
  const seen = new Set();
  for (let step = 0; step < 40; step += 1) {
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('[role="treeitem"][id]')].flatMap((node) =>
        node.hasAttribute('aria-expanded') ? [] : [node.id],
      ),
    );
    for (const id of ids) seen.add(id);
    const moved = await page.evaluate(() => {
      const tree = document.querySelector('[role="tree"]');
      let node = tree?.parentElement ?? null;
      while (node && node.scrollHeight <= node.clientHeight + 4) node = node.parentElement;
      if (!node) return false;
      const before = node.scrollTop;
      node.scrollTop = before + Math.max(240, node.clientHeight * 0.8);
      return node.scrollTop !== before;
    });
    if (!moved) break;
    await page.waitForTimeout(150);
  }
  return [...seen];
}

async function expandAll(page) {
  for (let guard = 0; guard < 80; guard += 1) {
    const collapsed = page.locator('[role="treeitem"][aria-expanded="false"]');
    if ((await collapsed.count()) === 0) return;
    const row = collapsed.first();
    const button = row.locator('button').first();
    if ((await button.count()) > 0) await button.click();
    else await row.click();
    await page.waitForTimeout(150);
  }
}

async function expandTo(page, id) {
  const parts = id.split('/');
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const path = parts.slice(0, depth).join('/');
    const row = page.locator(`[role="treeitem"][id="${path}"]`);
    if ((await row.count()) === 0) await expandAll(page);
    // GitHub folds single-child folders into one row, like services/payments.
    if ((await row.count()) === 0 && depth < parts.length) continue;
    if ((await row.getAttribute('aria-expanded')) === 'false') {
      const button = row.locator('button').first();
      if ((await button.count()) > 0) await button.click();
      else await row.click();
      await page.waitForTimeout(200);
    }
  }
}

async function ownAction(row) {
  // The circle is injected after GitHub renders the row, so give it a moment.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const handle = await row.evaluateHandle((element) =>
      [...element.querySelectorAll('[data-diffseek-viewed-action]')].find(
        (node) => node.closest('[role="treeitem"]') === element,
      ) ?? null,
    );
    const element = handle.asElement();
    if (element) return element;
    await row.page().waitForTimeout(200);
  }
  throw new Error(`Viewed circle is missing on ${await row.getAttribute('id').catch(() => 'a row')}`);
}

async function paymentsRow(page) {
  const exact = page.locator(
    '.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@acme/payments"])',
  );
  if ((await exact.count()) > 0) return exact.first();
  const fallback = page.locator('.diffseek-menu-row', { hasText: 'payments' }).first();
  if ((await fallback.count()) === 0) throw new Error('Owners row for payments was not found');
  return fallback;
}

function filesTab(page) {
  const anchored = page.locator('#prs-files-anchor-tab');
  return anchored.or(page.getByRole('link', { name: /Files changed/ })).first();
}

async function counter(page, count) {
  const source = count == null ? /\d+\s*\/\s*82/ : new RegExp(`\\b${count}\\s*/\\s*82\\b`);
  const matches = page.getByText(source);
  const found = await matches.count();
  for (let index = 0; index < found; index += 1) {
    const item = matches.nth(index);
    const text = await item.innerText().catch(() => '');
    if (/viewed/i.test(text) && (await item.isVisible())) return item;
  }
  throw new Error(`Could not find ${count ?? 'N'} / 82 viewed`);
}

async function expectCounter(page, count) {
  if (!(await hasCounter(page, count))) await counter(page, count);
}

async function frame(page, locators, width, height, pad = 12) {
  await locators[0].evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  for (const locator of locators) await locator.scrollIntoViewIfNeeded();
  await settleLayout(page);
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('A shot subject is outside the viewport');
    boxes.push(box);
  }
  const top = Math.min(...boxes.map((box) => box.y));
  const left = Math.min(...boxes.map((box) => box.x));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  if (right - left > width || bottom - top > height) {
    throw new Error(
      `Subjects span ${Math.ceil(right - left)}x${Math.ceil(bottom - top)} CSS px and the clip is ${Math.round(width)}x${Math.round(height)}: ${JSON.stringify(boxes.map((box) => [Math.round(box.x), Math.round(box.y)]))}`,
    );
  }
  const size = page.viewportSize() ?? viewport;
  let x = Math.min(Math.max(0, left - 16), size.width - width);
  let y = Math.min(Math.max(0, top - pad), size.height - height);
  if (x + width < right) x = Math.max(0, right - width);
  if (y + height < bottom) y = Math.max(0, bottom - height);
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

/**
 * GitHub's menu only re-anchors to its button after a resize or a capture,
 * not after a scroll. Nudge it into place before anything is measured.
 */
async function settleLayout(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  await page.screenshot({ type: 'png' });
  await page.waitForTimeout(300);
}

function layoutProbe(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('[data-diffseek="filters"]')?.getBoundingClientRect();
    return [scrollX, scrollY, Math.round(menu?.x ?? -1), Math.round(menu?.y ?? -1)].join(',');
  });
}

/**
 * Captures the whole viewport and crops later. A clipped capture can make
 * Chromium resize the page for a moment, and GitHub's menu jumps when it does.
 */
async function shoot(page, clip) {
  const before = await layoutProbe(page);
  const buffer = await page.screenshot({ type: 'png' });
  const after = await layoutProbe(page);
  if (before !== after) throw new Error(`Layout moved during capture: ${before} -> ${after}`);
  const size = page.viewportSize() ?? viewport;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== Math.round(size.width * scale) || height !== Math.round(size.height * scale)) {
    throw new Error(`Shot is ${width}x${height}, expected the ${size.width}x${size.height} viewport at ${scale}x`);
  }
  return { buffer, clip, width, height };
}

/** The viewed circle is painted by ::before; return that disc's box. */
async function discOf(target) {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const before = getComputedStyle(element, '::before');
    const width = Number.parseFloat(before.width) || rect.width;
    const height = Number.parseFloat(before.height) || rect.height;
    if (before.position !== 'absolute') {
      return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
    }
    const right = Number.parseFloat(before.right);
    const bottom = Number.parseFloat(before.bottom);
    const left = Number.parseFloat(before.left);
    const top = Number.parseFloat(before.top);
    const x = Number.isFinite(left) ? rect.left + left : rect.right - (right || 0) - width;
    const y = Number.isFinite(top) ? rect.top + top : rect.bottom - (bottom || 0) - height;
    return { x, y, width, height };
  });
}

async function outBox(target, clip, crop, left) {
  const box = typeof target.boundingBox === 'function' ? await target.boundingBox() : target;
  if (!box) throw new Error('An annotated element is off screen');
  // A clip may carry its own zoom; the capture is still at `scale`.
  const zoom = clip.zoom ?? scale;
  return {
    x: left + (box.x - clip.x) * zoom - crop,
    y: (box.y - clip.y) * zoom,
    w: box.width * zoom,
    h: box.height * zoom,
  };
}

/** Left offset that puts the menu 16px from the left of a 640px half. */
function halfCrop(menuBox, clip) {
  const left = (menuBox.x - clip.x) * scale;
  return Math.max(0, Math.min(outWidth - 640, Math.round(left - 16)));
}


/**
 * Lays out shot crops on a 1280x800 canvas and draws callouts on top:
 * an outline on the target, a thin leader line, and a white label.
 */
async function compose(name, { layers, tags, notes }) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: outWidth, height: outHeight },
      deviceScaleFactor: 1,
    });
    const host = await context.newPage();
    await host.setContent(`<!doctype html><style>
      html,body{margin:0;width:${outWidth}px;height:${outHeight}px;overflow:hidden;font-family:Inter,'Noto Sans',sans-serif}
      .layer{position:absolute;top:0;height:${outHeight}px;overflow:hidden}
      .layer img{display:block}
      .divider{position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;background:#fff;box-shadow:0 0 0 1px rgba(31,35,40,.18)}
      .tag{position:absolute;white-space:nowrap;padding:6px 14px;border-radius:999px;background:${accent};color:#fff;font-size:17px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .note{position:absolute;box-sizing:border-box;padding:7px 11px 8px;border:2px solid ${accent};border-radius:9px;background:#fff;box-shadow:0 3px 12px rgba(31,35,40,.16)}
      .note b{display:block;font-size:16px;line-height:20px;color:#1f2328}
      .note span{display:block;margin-top:2px;font-size:13.5px;line-height:18px;color:#424a53}
      .note span strong{font-weight:700;color:#1f2328}
      svg{position:absolute;inset:0}
    </style><body></body>`);
    await host.evaluate(({ layers, tags, notes, accent }) => {
      const body = document.body;
      for (const layer of layers) {
        const box = document.createElement('div');
        box.className = 'layer';
        box.style.left = `${layer.left}px`;
        box.style.width = `${layer.width}px`;
        const image = document.createElement('img');
        image.src = layer.src;
        image.style.width = `${layer.width0 * layer.ratio}px`;
        image.style.height = `${layer.height0 * layer.ratio}px`;
        image.style.marginLeft = `${-(layer.x0 + layer.crop)}px`;
        image.style.marginTop = `${-layer.y0}px`;
        box.append(image);
        body.append(box);
        if (layer.left > 0) {
          const divider = document.createElement('div');
          divider.className = 'divider';
          divider.style.left = `${layer.left}px`;
          body.append(divider);
        }
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '1280');
      svg.setAttribute('height', '800');
      body.append(svg);
      const draw = (tag, attrs) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        svg.append(node);
      };
      for (const note of notes) {
        const label = document.createElement('div');
        label.className = 'note';
        label.style.left = `${note.at[0]}px`;
        label.style.top = `${note.at[1]}px`;
        label.style.width = `${note.width}px`;
        const title = document.createElement('b');
        title.textContent = note.title;
        label.append(title);
        if (note.sub) {
          const sub = document.createElement('span');
          sub.textContent = note.sub;
          label.append(sub);
        }
        // `lines` is markup written in this script, for a bold word or two.
        for (const line of note.lines ?? []) {
          const sub = document.createElement('span');
          sub.innerHTML = line;
          label.append(sub);
        }
        body.append(label);
        if (!note.target) continue;
        if (note.inside) {
          const t = note.target;
          draw('rect', { x: t.x, y: t.y, width: t.w, height: t.h, rx: 8, fill: 'none', stroke: accent, 'stroke-width': 2.5 });
          continue;
        }
        const rect = label.getBoundingClientRect();
        const t = note.target;
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        const ax = Math.max(rect.left, Math.min(cx, rect.right));
        const ay = Math.max(rect.top, Math.min(cy, rect.bottom));
        const dx = ax - cx;
        const dy = ay - cy;
        const length = Math.hypot(dx, dy) || 1;
        let sx;
        let sy;
        if (note.shape === 'ring') {
          const r = note.ring ?? Math.max(t.w, t.h) / 2 + 6;
          draw('circle', { cx, cy, r, fill: 'none', stroke: accent, 'stroke-width': 2.5 });
          sx = cx + (dx / length) * r;
          sy = cy + (dy / length) * r;
        } else {
          const pad = 4;
          const hw = t.w / 2 + pad;
          const hh = t.h / 2 + pad;
          draw('rect', { x: cx - hw, y: cy - hh, width: hw * 2, height: hh * 2, rx: 8, fill: 'none', stroke: accent, 'stroke-width': 2.5 });
          const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
          sx = cx + dx * k;
          sy = cy + dy * k;
        }
        draw('line', { x1: sx, y1: sy, x2: ax, y2: ay, stroke: accent, 'stroke-width': 2, 'stroke-linecap': 'round' });
        draw('circle', { cx: ax, cy: ay, r: 3.5, fill: accent });
        if (note.arrow) {
          // Arrowhead on the target end, pointing at the target.
          const ux = (sx - ax) / (Math.hypot(sx - ax, sy - ay) || 1);
          const uy = (sy - ay) / (Math.hypot(sx - ax, sy - ay) || 1);
          const size = 11;
          const points = [
            [sx, sy],
            [sx - ux * size - uy * size * 0.5, sy - uy * size + ux * size * 0.5],
            [sx - ux * size + uy * size * 0.5, sy - uy * size - ux * size * 0.5],
          ];
          draw('polygon', { points: points.map((point) => point.join(',')).join(' '), fill: accent });
        }
        if (note.target2) {
          // A second leader from the label to the matching source lines.
          const u = note.target2;
          const pad = 3;
          draw('rect', { x: u.x - pad, y: u.y - pad, width: u.w + pad * 2, height: u.h + pad * 2, rx: 6, fill: 'none', stroke: accent, 'stroke-width': 2.5 });
          // The second target may sit on either side of the label.
          const onLeft = u.x + u.w < rect.left;
          const ex = onLeft ? u.x + u.w + pad : u.x - pad;
          const ey = Math.max(u.y, Math.min(rect.top + rect.height / 2, u.y + u.h));
          const bx = onLeft ? rect.left : rect.right;
          const by = Math.max(rect.top + 8, Math.min(ey, rect.bottom - 8));
          draw('line', { x1: bx, y1: by, x2: ex, y2: ey, stroke: accent, 'stroke-width': 2, 'stroke-linecap': 'round' });
          draw('circle', { cx: bx, cy: by, r: 3.5, fill: accent });
        }
      }
      for (const item of tags) {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = item.text;
        tag.style.left = `${item.x}px`;
        tag.style.top = `${item.y}px`;
        if (item.size) tag.style.fontSize = `${item.size}px`;
        if (item.center) tag.style.transform = 'translateX(-50%)';
        body.append(tag);
      }
    }, {
      layers: layers.map(({ shot, left, width, crop }) => ({
        left,
        width,
        crop,
        ratio: (shot.clip.zoom ?? scale) / scale,
        x0: Math.round(shot.clip.x * (shot.clip.zoom ?? scale)),
        y0: Math.round(shot.clip.y * (shot.clip.zoom ?? scale)),
        width0: shot.width,
        height0: shot.height,
        src: `data:image/png;base64,${shot.buffer.toString('base64')}`,
      })),
      tags,
      notes,
      accent,
    });
    await host.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    await host.evaluate(() => document.fonts.ready);
    const buffer = await host.screenshot({ type: 'png' });
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== outWidth || height !== outHeight) {
      throw new Error(`Annotated shot is ${width}x${height}, expected ${outWidth}x${outHeight}`);
    }
    await writeFile(join(shotDir, name), buffer);
    console.log('wrote', join(shotDir, name), `${width}x${height}`);
  } finally {
    await browser.close();
  }
}

async function cursorOn(page, locator, badge) {
  await placeCursor(page, ...(await pointOf(locator, badge)));
}

async function pointOf(target, badge) {
  const point = await target.evaluate((element, useBadge) => {
    const rect = element.getBoundingClientRect();
    if (!useBadge) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    const before = getComputedStyle(element, '::before');
    const width = Number.parseFloat(before.width) || 12;
    const height = Number.parseFloat(before.height) || 12;
    const right = Number.parseFloat(before.right) || 0;
    const bottom = Number.parseFloat(before.bottom) || 0;
    return {
      x: rect.right - right - width / 2,
      y: rect.bottom - bottom - height / 2,
    };
  }, badge);
  return [point.x, point.y];
}

/** Hover only: the shots carry no drawn cursor, hover state shows the target. */
async function placeCursor(page, x, y) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
}

async function openMenu(page) {
  if ((await page.locator('[data-diffseek="filters"]').count()) > 0) return;
  await page.getByRole('button', { name: 'Filter options' }).click();
  await page.locator('[data-diffseek="filters"]').waitFor({ timeout: 30_000 });
}

async function closeMenu(page) {
  if ((await page.locator('[data-diffseek="filters"]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await page.locator('[data-diffseek="filters"]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
}

/** Wait for a live DiffSeek snackbar whose text matches, and return that text. */
async function waitForToast(page, pattern, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const texts = await page.locator('[data-diffseek="snackbar"]').allTextContents();
    const hit = texts.find((text) => pattern.test(text));
    if (hit) return hit;
    await page.waitForTimeout(150);
  }
  throw new Error(`No snackbar matched ${pattern}`);
}

async function waitForToasts(page) {
  const snacks = page.locator('[data-diffseek="snackbar"]');
  const started = Date.now();
  let saw = false;
  while (Date.now() - started < 20_000) {
    const count = await snacks.count();
    if (count > 0) saw = true;
    if (saw && count === 0) return;
    if (!saw && Date.now() - started > 1_200) return;
    await page.waitForTimeout(200);
  }
  throw new Error('DiffSeek toasts did not clear');
}
