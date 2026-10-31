/**
 * Store screenshots for https://github.com/sha-tm/diffseek-test-data/pull/2.
 *
 *   pnpm build
 *   STORAGE_STATE=/path/to/state.json node scripts/store-screenshots.mjs
 *
 * STORAGE_STATE is a Playwright storage-state JSON file. The script never
 * prints it. Each shot uses a fresh Chromium profile with the built extension.
 * Shots 2-4 turn auto-view off in that profile first, so the PR stays at its
 * 12/82 baseline. Viewed checkboxes live on GitHub, so shot 1, which changes
 * them, restores the baseline before the browser closes.
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
  await stage('1', () => withPage(async (page) => {
    try {
      return await noiseCut(page);
    } finally {
      // Turn auto-view off first, or the restore's reload marks the generated files again.
      await quietProfile(page);
      await restoreBaseline(page);
    }
  }, null), noiseCutLayout);
}
if (pick.has('2')) await stage('2', () => withPage(onlySplit), onlySplitLayout);
if (pick.has('3')) await stage('3', () => withPage(viewedBadges), viewedBadgesLayout);
if (pick.has('4')) await stage('4', () => withPage(sourcesSplit), sourcesSplitLayout);

/**
 * Captures a shot on GitHub, keeps the capture next to the shots, then draws
 * the callouts. REPLAY=1 redraws from the kept capture without opening GitHub.
 */
async function stage(id, capture, layout) {
  const file = join(shotDir, `capture-${id}.json`);
  let data;
  if (process.env.REPLAY) {
    data = JSON.parse(await readFile(file, 'utf8'));
  } else {
    data = await capture();
    await writeFile(file, JSON.stringify(data));
  }
  await layout(data);
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
    return await run(page).catch(async (error) => {
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
  // Framed like shot 3: the full width at a lower zoom, from the tab bar
  // down, so the file tree, the counter and the open menu all show.
  const zoom = 1.2;
  const width = outWidth / zoom;
  await filesTab(page).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settleLayout(page);
  const size = page.viewportSize() ?? viewport;
  const clip = { x: size.width - width, y: 0, width, height: outHeight / zoom, zoom };
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  await waitForQuiet(page);
  if ((await page.locator('[data-diffseek="snackbar"]').count()) > 0) throw new Error('A toast is on screen');
  const signs = await signBox(page, ['viewed', 'generated'], clip);
  const pillBox = await outBox(pill, clip, 0, 0);
  const menuBox = await outBox(page.locator('[data-diffseek="filters"]'), clip, 0, 0);
  // Tree rows on screen, so the labels can be placed clear of them.
  const treeRows = [];
  for (const box of await page.evaluate(() =>
    [...document.querySelectorAll('[role="treeitem"]')].map((node) => {
      const content = node.querySelector('.PRIVATE_TreeView-item-content') ?? node;
      const rect = content.getBoundingClientRect();
      const text = node.querySelector('.PRIVATE_TreeView-item-content-text') ?? content;
      const range = document.createRange();
      range.selectNodeContents(text);
      const ink = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: Math.max(0, ink.right - rect.x), height: rect.height, id: node.id };
    }),
  )) treeRows.push({ ...(await outBox(box, clip, 0, 0)), id: box.id });
  console.log('shot 1 menu:', JSON.stringify(menuBox), 'signs:', JSON.stringify(signs));
  const shot = await shoot(page, clip);
  return { shot, signs, pillBox, menuBox, treeRows };
}

async function noiseCutLayout({ shot, signs, pillBox, menuBox }) {
  const center = signs.x + signs.w / 2;
  await compose('01-noise-cut.png', {
    layers: [{ shot, left: 0, width: outWidth, crop: 0 }],
    tags: [],
    notes: [
      // Centred on the signs, so the leader drops straight onto them.
      { target: signs, shape: 'rect', at: [center, Math.round(signs.y - 140)], align: 'center', title: 'Hidden by default', body: 'Viewed and generated files stay out of the way. / Click the row to change the default.' },
      { target: pillBox, shape: 'rect', at: [Math.round(menuBox.x + menuBox.w + 36), Math.round(pillBox.y + 56)], title: 'Auto-view by default', body: 'Marked viewed automatically. / Toggle to change.' },
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
  // The click leaves focus on the payments "only" button, and :focus-within
  // paints that row as hovered. Drop focus, so the row shows its selection only.
  await page.evaluate(() => document.activeElement?.blur?.());
  await openMenu(page);
  await page.mouse.move(2, 2);
  const afterClip = await frame(page, subjects, clipWidth, clipHeight, 4);
  // "all" only shows while its section title is hovered.
  const ownersTitle = page.locator('.diffseek-menu-section:has([data-filter-kind="owners"]) .diffseek-menu-section-title');
  const ownersAll = ownersTitle.locator('[data-filter-all]');
  await ownersTitle.hover();
  await cursorOn(page, ownersAll, false);
  await page.waitForTimeout(300);
  await expectOnlyAllHovered(page);
  const afterCrop = halfCrop(await menu.boundingBox(), afterClip);
  const allBox = await outBox(ownersAll, afterClip, afterCrop, 640);
  // The restore icon in the menu's top right corner brings every section back.
  const resetBox = await outBox(menu.locator('[data-reset-filters]'), afterClip, afterCrop, 640);
  const afterShot = await shoot(page, afterClip);
  return { beforeShot, afterShot, beforeCrop, afterCrop, onlyBox, allBox, resetBox };
}

/** In the After half, the "all" pill is the one hovered thing in the menu. */
async function expectOnlyAllHovered(page) {
  const state = await page.evaluate(() => {
    const menu = document.querySelector('[data-diffseek="filters"]');
    const rows = [...(menu?.querySelectorAll('.diffseek-menu-row') ?? [])];
    const all = menu?.querySelector('.diffseek-menu-section:has([data-filter-kind="owners"]) [data-filter-all]');
    const payments = rows.find((row) => row.querySelector('[data-filter-value="@acme/payments"]'));
    return {
      busy: rows.filter((row) => row.matches(':hover, :focus-within')).map((row) => row.textContent.trim()),
      allHovered: Boolean(all?.matches(':hover')),
      paymentsBackground: payments && getComputedStyle(payments).backgroundColor,
      paymentsOnly: payments && getComputedStyle(payments.querySelector('.diffseek-menu-only')).opacity,
    };
  });
  console.log('after hover:', JSON.stringify(state));
  if (state.busy.length > 0 || !state.allHovered || state.paymentsOnly !== '0') {
    throw new Error(`Only the "all" pill should look hovered: ${JSON.stringify(state)}`);
  }
}

async function onlySplitLayout({ beforeShot, afterShot, beforeCrop, afterCrop, onlyBox, allBox, resetBox }) {
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
      // Each label stays inside its own half, right of the menu. The "only"
      // leader rises over the empty end of the Owners title, and the "all"
      // leader runs level, so neither crosses a count.
      { target: onlyBox, shape: 'rect', at: [Math.round(onlyBox.x + onlyBox.w + 100), Math.round(onlyBox.y - 68)], within: [0, 640], exit: 'top', title: 'only', body: 'Just this owner, group or format.' },
      { target: allBox, shape: 'rect', at: [Math.round(allBox.x + allBox.w + 40), Math.round(allBox.y + allBox.h / 2)], middle: true, within: [640, outWidth], title: 'all', body: 'The whole section again.' },
      // Level with the icon, right of the menu: below the After tag and
      // above the "all" label.
      { target: resetBox, shape: 'rect', at: [Math.round(resetBox.x + resetBox.w + 28), Math.round(resetBox.y + resetBox.h / 2)], middle: true, within: [640, outWidth], title: 'Restore all sections' },
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
  // Formats with no linguist-language line fall back to the file extension.
  const otherFormats = ['proto', 'snap', 'sql', 'yaml'];
  const formatRow = (name) => menu.locator('.diffseek-menu-row').filter({ has: page.locator('[data-filter-kind="languages"]').getByText(name, { exact: true }) }).first();
  const menuClip = await frame(page, [menu.locator('[data-filter-kind="viewed"]'), formatRow(otherFormats.at(-1))], clipWidth, clipHeight);
  await page.mouse.move(2, 2);
  // The menu keeps a 430px strip on the right; the labels sit between it
  // and the source lines.
  const menuLeft = outWidth - 430;
  const menuBox = await menu.boundingBox();
  const menuCrop = Math.round((menuBox.x - menuClip.x) * scale - 16);
  // The menu's own box on the canvas; the page around it is painted white.
  const menuFrame = await outBox(menuBox, menuClip, menuCrop, menuLeft);
  const menuRows = {};
  for (const [key, row] of Object.entries(rows)) menuRows[key] = await outBox(row, menuClip, menuCrop, menuLeft);
  const formatBoxes = [];
  for (const name of otherFormats) formatBoxes.push(await outBox(formatRow(name), menuClip, menuCrop, menuLeft));
  // Trim where the TypeScript row meets proto, so the two outlines keep a gap.
  menuRows.typescript = { ...menuRows.typescript, h: menuRows.typescript.h - 6 };
  const otherTop = Math.min(...formatBoxes.map((box) => box.y)) + 8;
  menuRows.other = {
    x: formatBoxes[0].x,
    y: otherTop,
    w: formatBoxes[0].w,
    h: Math.max(...formatBoxes.map((box) => box.y + box.h)) - otherTop,
  };
  console.log('other formats:', JSON.stringify(menuRows.other));
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
    // With only two short files left, the page can end above the shot, and
    // the browser then clamps the scroll mid-capture. Keep blank room below.
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.body.append(spacer);
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
    // The kept lines jump (9-11, then 3-7, 19-23, 25-27), so each comment
    // line becomes a thin white cutout. Every chunk then reads as an excerpt.
    for (const path of kept) {
      const file = document.querySelector(`copilot-diff-entry[data-file-path="${path}"]`);
      for (const row of file?.querySelectorAll('tr') ?? []) {
        if (row.style.display === 'none' || !row.querySelector('td[data-line-number]')) continue;
        const code = row.querySelector('.blob-code-inner') ?? row.lastElementChild;
        if (!/^#/.test((code?.textContent ?? '').trim())) continue;
        row.style.setProperty('height', '10px', 'important');
        for (const cell of row.querySelectorAll('td')) {
          cell.textContent = '';
          cell.removeAttribute('data-line-number');
          for (const [key, value] of [['background', '#fff'], ['height', '10px'], ['padding', '0'], ['border', '0'], ['font-size', '0'], ['line-height', '0']]) {
            cell.style.setProperty(key, value, 'important');
          }
        }
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
  // A little smaller than the menu, so the longest source line clears the
  // label column.
  const sourceZoom = 1.35;
  const sourceClip = { x: top.x - 4, y: top.y - 10, width: outWidth / sourceZoom, height: outHeight / sourceZoom, zoom: sourceZoom };
  const lines = {
    payments: await lineRows('CODEOWNERS', [10, 11]),
    generated: await lineRows('.gitattributes', [4, 5, 6, 7]),
    tests: await lineRows('.gitattributes', [20, 21, 22, 23]),
    typescript: await lineRows('.gitattributes', [26, 27]),
  };
  console.log('sources:', JSON.stringify(Object.fromEntries(Object.entries(lines).map(([key, value]) => [key, value.text]))));
  const source = {};
  for (const [key, box] of Object.entries(lines)) {
    // Highlight the code text, not the full-width row. compose() trims the
    // box where it would run under its label.
    source[key] = await outBox(box, sourceClip, 0, 0);
  }
  const sourceShot = await shoot(page, sourceClip);
  return { sourceShot, menuShot, menuLeft, menuCrop, menuFrame, menuRows, source };
}

async function sourcesSplitLayout({ sourceShot, menuShot, menuLeft, menuCrop, menuFrame, menuRows, source }) {
  // One column of labels, right-aligned against the menu and all one width.
  const labelRight = menuLeft - 12;
  const note = (key, title, body, extra = {}) => ({
    target: menuRows[key],
    arrow: true,
    target2: source[key],
    shape: 'rect',
    at: [labelRight, Math.round(source[key].y + source[key].h / 2)],
    align: 'right',
    middle: true,
    group: 'sources',
    title,
    body,
    ...extra,
  });
  await compose('04-sources.png', {
    layers: [
      { shot: sourceShot, left: 0, width: menuLeft, crop: 0 },
      { shot: menuShot, left: menuLeft, width: outWidth - menuLeft, crop: menuCrop },
    ],
    // Clean white margins around the menu: no GitHub page peeks out.
    masks: [
      { x: menuLeft + 2, y: 0, w: Math.max(0, Math.floor(menuFrame.x) - menuLeft - 2), h: outHeight },
      { x: Math.ceil(menuFrame.x + menuFrame.w), y: 0, w: outWidth, h: outHeight },
      { x: menuLeft + 2, y: Math.ceil(menuFrame.y + menuFrame.h), w: outWidth, h: outHeight },
      { x: menuLeft + 2, y: 0, w: outWidth, h: Math.max(0, Math.floor(menuFrame.y)) },
    ],
    tags: [
      { x: Math.round((menuLeft - 210) / 2), y: 742, text: 'Repository files', center: true },
      // Clear of the menu rows: in the label column, against the menu edge.
      { x: labelRight, y: 742, text: 'DiffSeek menu', right: true },
    ],
    notes: [
      note('payments', 'Owners', 'from `CODEOWNERS`', { enter: 'left' }),
      note('generated', 'Generated', '`linguist-generated` paths'),
      note('tests', 'Groups', 'your own `group=` attribute'),
      note('typescript', 'Languages', '`linguist-language` overrides', { id: 'formats', enter: 'left' }),
      // No config line feeds these rows, so this label has no source box. It
      // sits under the Formats label, so the two arrows run side by side.
      {
        target: menuRows.other,
        arrow: true,
        enter: 'left',
        shape: 'rect',
        at: [labelRight, 0],
        align: 'right',
        below: ['formats', 14],
        group: 'sources',
        title: 'Other formats',
        body: 'labeled by file extension',
      },
    ],
  });
}

function webRow(page) {
  return page.locator('.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@acme/web-platform"])');
}

/**
 * Tree and menu badges at the 12/82 baseline, with no toast on screen. The
 * shot shows the full viewport width, so it runs at a lower zoom than the
 * others.
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
  await waitForQuiet(page);
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
    tree: await outBox(page.locator('[role="tree"]'), clip, 0, 0),
  };
  console.log('badges:', await (await ownAction(folder)).getAttribute('title'), '|', await web.getAttribute('title'));
  if ((await page.locator('[data-diffseek="snackbar"]').count()) > 0) throw new Error('A toast is on screen');
  const shot = await shoot(page, clip);
  return { shot, boxes };
}

async function viewedBadgesLayout({ shot, boxes }) {
  const treeAt = [Math.round(boxes.folder.x + 90), Math.round(boxes.folder.y - 34)];
  const menuAt = [Math.round(boxes.menu.x + boxes.menu.w + 34), Math.round(boxes.circle.y + 20)];
  const ringOf = (box) => ({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, r: Math.max(box.w, box.h) / 2 + 6 });
  const folderRing = ringOf(boxes.folder);
  // The third label sits over the tree, just left of the menu, between the
  // PaymentMethodsPage.test.tsx row and the featureFlags.ts row (tree rows are
  // 32 CSS px apart), so it only hides the tail of one file name. Both arrows
  // are single straight segments. The one to the folder ring leaves the
  // label's top right and climbs through the blank space right of the names,
  // under the File tree label. The one to the menu badge leaves the label's
  // right edge and crosses the menu in the empty gap between the App and
  // Config rows, under the web-platform count.
  const clickAt = [Math.round(boxes.menu.x - 262), Math.round(boxes.folder.y + 236)];
  await compose('03-viewed-badges.png', {
    layers: [{ shot, left: 0, width: outWidth, crop: 0 }],
    tags: [],
    notes: [
      { id: 'tree', target: boxes.folder, shape: 'ring', at: treeAt, title: 'File tree badges', body: 'Progress over the files **shown** / ○ none · ◐ some · ● all' },
      { id: 'menu', target: boxes.circle, shape: 'ring', at: menuAt, title: 'Menu badges', body: 'Progress over the **whole** category, / hidden ones included' },
      {
        routes: [
          { from: 'top', offset: 220, ring: folderRing },
          { from: 'right', offset: 15, ring: ringOf(boxes.circle) },
        ],
        at: clickAt,
        title: 'Click any badge to mark',
        body: 'files viewed, click again to unmark',
      },
    ],
  });
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
  // Base64, so a capture can be kept as JSON and replayed.
  return { png: buffer.toString('base64'), clip, width, height };
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
async function compose(name, { layers, masks = [], tags, notes }) {
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
      .note{position:absolute;box-sizing:border-box;width:max-content;padding:7px 12px 8px;border:2px solid ${accent};border-radius:9px;background:#fff;box-shadow:0 3px 12px rgba(31,35,40,.16)}
      .note b{display:block;white-space:nowrap;font-size:16px;line-height:21px;font-weight:700;color:#1f2328}
      .note span{display:block;white-space:nowrap;font-size:14px;line-height:19px;color:#424a53}
      .note b + span{margin-top:2px}
      .note strong{font-weight:700;color:#1f2328}
      .note code{font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;font-size:12.5px;padding:1px 4px;border-radius:5px;background:rgba(175,184,193,.24);color:#1f2328}
      svg{position:absolute;inset:0}
    </style><body></body>`);
    await host.evaluate(({ layers, masks, tags, notes, accent }) => {
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
      for (const mask of masks) {
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${mask.x}px;top:${mask.y}px;width:${mask.w}px;height:${mask.h}px;background:#fff`;
        body.append(box);
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
      // A leader meets a label on a straight stretch of its edge, clear of
      // the rounded corners, so the dot never sits on a curve.
      const corner = 14;
      const anchor = (rect, x, y) => {
        const clampX = (value) => Math.max(rect.left + corner, Math.min(value, rect.right - corner));
        const clampY = (value) => Math.max(rect.top + corner, Math.min(value, rect.bottom - corner));
        if (x < rect.left) return [rect.left, clampY(y)];
        if (x > rect.right) return [rect.right, clampY(y)];
        if (y < rect.top) return [clampX(x), rect.top];
        return [clampX(x), rect.bottom];
      };
      const arrowhead = (fromX, fromY, toX, toY) => {
        const length = Math.hypot(toX - fromX, toY - fromY) || 1;
        const ux = (toX - fromX) / length;
        const uy = (toY - fromY) / length;
        const size = 11;
        const points = [
          [toX, toY],
          [toX - ux * size - uy * size * 0.5, toY - uy * size + ux * size * 0.5],
          [toX - ux * size + uy * size * 0.5, toY - uy * size - ux * size * 0.5],
        ];
        draw('polygon', { points: points.map((point) => point.join(',')).join(' '), fill: accent });
      };
      // Copy markup: " / " breaks a line, **x** is bold, `x` is code.
      const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const markup = (text) => escape(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
      const labels = {};
      const placed = notes.map((note) => {
        const label = document.createElement('div');
        label.className = 'note';
        const title = document.createElement('b');
        title.innerHTML = markup(note.title);
        label.append(title);
        for (const line of note.body ? note.body.split(' / ') : []) {
          const sub = document.createElement('span');
          sub.innerHTML = markup(line);
          label.append(sub);
        }
        body.append(label);
        if (note.id) labels[note.id] = label;
        return label;
      });
      // Labels hug their copy; a group shares the widest width.
      const widths = {};
      placed.forEach((label, index) => {
        const group = notes[index].group;
        if (group) widths[group] = Math.max(widths[group] ?? 0, Math.ceil(label.getBoundingClientRect().width));
      });
      placed.forEach((label, index) => {
        const note = notes[index];
        if (note.group) label.style.width = `${widths[note.group]}px`;
        const { width, height } = label.getBoundingClientRect();
        let left = note.at[0];
        if (note.align === 'center') left -= width / 2;
        if (note.align === 'right') left -= width;
        if (note.within) left = Math.max(note.within[0] + 12, Math.min(left, note.within[1] - 12 - width));
        let top = note.middle ? note.at[1] - height / 2 : note.at[1];
        if (note.below) top = labels[note.below[0]].getBoundingClientRect().bottom + note.below[1];
        label.style.left = `${Math.round(left)}px`;
        label.style.top = `${Math.round(top)}px`;
      });
      for (const [index, note] of notes.entries()) {
        const label = placed[index];
        if (note.routes) {
          // Arrows from this label to rings drawn by other notes. A route
          // leaves the label's top or left edge, follows its elbows, and ends
          // on the ring's edge: level if the last elbow is level with the
          // ring, else aimed at its centre.
          const rect = label.getBoundingClientRect();
          for (const route of note.routes) {
            const { cx, cy, r } = route.ring;
            const via = route.via ?? [];
            // An offset pins the start: px from the label's left on the top
            // edge, or from its top on the right edge.
            const pinned = route.offset == null ? null : route.from === 'right'
              ? [rect.right, rect.top + route.offset]
              : route.from === 'top' ? [rect.left + route.offset, rect.top] : null;
            const start = pinned ?? (route.from === 'left'
              ? [rect.left, Math.max(rect.top + corner, Math.min(via[0]?.[1] ?? cy, rect.bottom - corner))]
              : [cx < rect.left + corner ? rect.left + corner : Math.min(cx, rect.right - corner), rect.top]);
            const last = via.at(-1) ?? start;
            const dy = last[1] - cy;
            let end;
            if (via.length > 0 && Math.abs(dy) < r) {
              end = [cx - Math.sign(cx - last[0]) * Math.sqrt(r * r - dy * dy), last[1]];
            } else {
              const length = Math.hypot(cx - last[0], cy - last[1]) || 1;
              end = [cx - ((cx - last[0]) / length) * r, cy - ((cy - last[1]) / length) * r];
            }
            const tip = 3;
            const length = Math.hypot(end[0] - last[0], end[1] - last[1]) || 1;
            const tipEnd = [end[0] - ((end[0] - last[0]) / length) * tip, end[1] - ((end[1] - last[1]) / length) * tip];
            const points = [start, ...via, tipEnd];
            draw('polyline', { points: points.map((point) => point.join(',')).join(' '), fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
            draw('circle', { cx: start[0], cy: start[1], r: 3.5, fill: accent });
            arrowhead(last[0], last[1], end[0], end[1]);
          }
        }
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
        const [ax, ay] = anchor(rect, cx, cy);
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
          if (note.enter === 'left') {
            // Enter through the left edge, level with the label where possible.
            sx = cx - hw;
            sy = Math.max(cy - hh + 10, Math.min(ay, cy + hh - 10));
          } else if (note.exit === 'top') {
            // Leave through the top edge, toward the label's side.
            sx = Math.max(cx - hw + 10, Math.min(ax, cx + hw - 10));
            sy = cy - hh;
          } else {
            const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
            sx = cx + dx * k;
            sy = cy + dy * k;
          }
        }
        draw('line', { x1: sx, y1: sy, x2: ax, y2: ay, stroke: accent, 'stroke-width': 2, 'stroke-linecap': 'round' });
        draw('circle', { cx: ax, cy: ay, r: 3.5, fill: accent });
        // Arrowhead on the target end, pointing at the target.
        if (note.arrow) arrowhead(ax, ay, sx, sy);
        if (note.target2) {
          // A second leader from the label to the matching source lines.
          const pad = 3;
          // Stop a source box short of a label to its right.
          const gap = 14;
          const u = note.target2.x < rect.left
            ? { ...note.target2, w: Math.min(note.target2.w, rect.left - gap - pad - note.target2.x) }
            : note.target2;
          draw('rect', { x: u.x - pad, y: u.y - pad, width: u.w + pad * 2, height: u.h + pad * 2, rx: 6, fill: 'none', stroke: accent, 'stroke-width': 2.5 });
          // The second target may sit on either side of the label.
          const onLeft = u.x + u.w < rect.left;
          const ex = onLeft ? u.x + u.w + pad : u.x - pad;
          const ey = Math.max(u.y, Math.min(rect.top + rect.height / 2, u.y + u.h));
          const bx = onLeft ? rect.left : rect.right;
          const by = Math.max(rect.top + corner, Math.min(ey, rect.bottom - corner));
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
        if (item.right) tag.style.transform = 'translateX(-100%)';
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
        src: `data:image/png;base64,${shot.png}`,
      })),
      masks,
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
