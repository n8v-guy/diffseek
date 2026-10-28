/**
 * Store screenshots for https://github.com/sha-tm/diffseek-test-data/pull/2.
 *
 *   pnpm build
 *   STORAGE_STATE=/path/to/state.json node scripts/store-screenshots.mjs
 *
 * STORAGE_STATE is a Playwright storage-state JSON file. The script never
 * prints it. Each shot uses a fresh Chromium profile with the built extension.
 * Viewed checkboxes live on GitHub, so shots that change them restore the
 * 12/82 baseline before the browser closes.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const prUrl = 'https://github.com/sha-tm/diffseek-test-data/pull/2';
const changesUrl = `${prUrl}/changes?new_files_changed=true`;
const scale = 1.5;
const viewport = { width: 1080, height: 1000 };
const outWidth = 1280;
const outHeight = 800;
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
  ['01-noise-cut.png', '82 files changed. Only 24 need your eyes.'],
  ['02-only-payments.png', 'Before and after: only the payments owners.'],
  ['03-payments-db-viewed.png', 'Mark services/payments/db viewed, 12/82 to 15/82.'],
  ['04-partial-folder.png', 'Partial means this folder is partly reviewed.'],
];

const storageState = process.env.STORAGE_STATE;
if (!storageState) {
  console.error('Set STORAGE_STATE to a Playwright storage state JSON path.');
  process.exit(1);
}

await mkdir(shotDir, { recursive: true });
console.log('Shots land in', shotDir);
for (const [file, caption] of shots) console.log(`${file} — ${caption}`);

await withPage(async (page) => {
  try {
    await noiseCut(page);
  } finally {
    await restoreBaseline(page);
  }
});
await withPage(async (page) => {
  await showFacet(page, 'viewed');
  await showFacet(page, 'generated');
  await onlyPaymentsSplit(page);
});
await withPage(async (page) => {
  try {
    await paymentsFolder(page);
  } finally {
    await restoreBaseline(page);
  }
});
await withPage(async (page) => {
  await halfCircle(page);
});

async function withPage(run) {
  const userData = await mkdtemp(join(tmpdir(), 'diffseek-shot-'));
  const context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: process.env.HEADLESS !== '0',
    viewport,
    deviceScaleFactor: scale,
    storageState,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await openReview(page);
    await run(page);
  } finally {
    await context.close();
    await rm(userData, { recursive: true, force: true });
  }
}

async function openReview(page) {
  await page.goto(changesUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('[data-diffseek-viewed-action]').first().waitFor({ timeout: 120_000 });
  await waitForToasts(page);
}

async function noiseCut(page) {
  await openMenu(page);
  const row = page.locator('.diffseek-menu-row:has([data-filter-kind="generated"])');
  await row.hover();
  const pill = row.locator('[data-diffseek-always-read]');
  await pill.click();
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    if ((await page.locator('[data-diffseek="filters"]').count()) === 0) await openMenu(page);
    ready = await page.evaluate(() => {
      const control = document.querySelector('[data-diffseek-always-read]');
      const generated = document.querySelector('[data-filter-kind="generated"]');
      return control?.getAttribute('aria-pressed') === 'true'
        && generated?.getAttribute('aria-busy') !== 'true';
    });
    if (ready) break;
    await page.waitForTimeout(300);
  }
  if (!ready) throw new Error('Auto-view did not finish marking generated files');
  await waitForToasts(page);
  if ((await page.locator('[data-diffseek="filters"]').count()) === 0) await openMenu(page);
  await row.hover();
  await cursorOn(page, pill, false);
  await waitForToasts(page);
  const visible = await page.locator('[role="treeitem"][id]:not([hidden])').count();
  console.log('noise-cut visible tree rows:', visible);
  await saveShot(page, '01-noise-cut.png', await frame(page, [
    filesTab(page),
    await counter(page),
    pill,
  ], clipWidth, clipHeight));
}

async function onlyPaymentsSplit(page) {
  await openMenu(page);
  const row = await paymentsRow(page);
  await row.hover();
  const only = row.locator('.diffseek-menu-only');
  await cursorOn(page, only, false);
  const leftClip = await frame(page, [filesTab(page), await counter(page, 12), only], clipWidth, clipHeight);
  const leftShot = await shoot(page, leftClip);
  const onlyBox = await only.boundingBox();
  await only.click();
  await waitForToasts(page);
  await closeMenu(page);
  await hideCursor(page);
  const tree = page.locator('[role="treeitem"][id="services/payments"], [role="treeitem"][id="web/src/payments"]');
  await tree.first().waitFor({ timeout: 30_000 });
  const rightClip = await frame(page, [filesTab(page), await counter(page, 12), tree.first()], clipWidth, clipHeight);
  const rightShot = await shoot(page, rightClip);
  const treeBox = await tree.first().boundingBox();
  await stitchPair(leftShot, rightShot, cropOrigin(onlyBox, leftClip), cropOrigin(treeBox, rightClip));
}

async function paymentsFolder(page) {
  await openMenu(page);
  const row = await paymentsRow(page);
  await row.hover();
  await row.locator('.diffseek-menu-only').click();
  await waitForToasts(page);
  await closeMenu(page);
  await expectCounter(page, 12);
  const folder = page.locator('[role="treeitem"][id="services/payments/db"]');
  await expandTo(page, 'services/payments/db');
  await folder.waitFor({ timeout: 30_000 });
  const before = await ownAction(folder);
  await before.click();
  await expectCounter(page, 15);
  await waitForToasts(page);
  const action = await ownAction(folder);
  await cursorOnElement(page, action, true);
  await saveShot(page, '03-payments-db-viewed.png', await frame(page, [
    filesTab(page),
    await counter(page, 15),
    action,
  ], clipWidth, clipHeight));
  await action.click();
  await expectCounter(page, 12);
  await waitForToasts(page);
}

async function halfCircle(page) {
  await expandTo(page, 'web');
  const folder = page.locator('[role="treeitem"][id="web"]');
  const action = await ownAction(folder);
  const pressed = await action.getAttribute('aria-pressed');
  if (pressed !== 'mixed') {
    throw new Error(`web folder circle is ${pressed ?? 'missing'}, expected mixed at the 12/82 baseline`);
  }
  await cursorOnElement(page, action, true);
  await saveShot(page, '04-partial-folder.png', await frame(page, [
    filesTab(page),
    await counter(page, 12),
    action,
  ], clipWidth, clipHeight));
}

async function restoreBaseline(page) {
  if (page.isClosed()) return;
  await openMenu(page).catch(() => undefined);
  const pill = page.locator('[data-diffseek-always-read]');
  if ((await pill.count()) > 0 && (await pill.getAttribute('aria-pressed')) === 'true') {
    await pill.click();
    await waitForToasts(page);
  }
  await showFacet(page, 'viewed');
  await showFacet(page, 'generated');
  await closeMenu(page);
  const wanted = new Set(baseline);
  const ids = await collectFileIds(page);
  const missing = baseline.filter((path) => !ids.includes(path));
  if (missing.length > 0) {
    throw new Error(`Baseline files not in the tree: ${missing.join(', ')}`);
  }
  for (const id of ids) {
    await setFileViewed(page, id, wanted.has(id));
  }
  await waitForToasts(page);
  await expectCounter(page, 12);
  console.log('Baseline restored: 12/82 viewed.');
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
    if ((await row.getAttribute('aria-expanded')) === 'false') {
      const button = row.locator('button').first();
      if ((await button.count()) > 0) await button.click();
      else await row.click();
      await page.waitForTimeout(200);
    }
  }
}

async function ownAction(row) {
  const handle = await row.evaluateHandle((element) =>
    [...element.querySelectorAll('[data-diffseek-viewed-action]')].find(
      (node) => node.closest('[role="treeitem"]') === element,
    ) ?? null,
  );
  const element = handle.asElement();
  if (!element) throw new Error('Viewed circle is missing');
  return element;
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
  await counter(page, count);
}

async function frame(page, locators, width, height) {
  await locators[0].evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  for (const locator of locators) await locator.scrollIntoViewIfNeeded();
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
      `Subjects span ${Math.ceil(right - left)}x${Math.ceil(bottom - top)} CSS px and the clip is ${Math.round(width)}x${Math.round(height)}.`,
    );
  }
  const size = page.viewportSize() ?? viewport;
  let x = Math.min(Math.max(0, left - 16), size.width - width);
  let y = Math.min(Math.max(0, top - 12), size.height - height);
  if (x + width < right) x = Math.max(0, right - width);
  if (y + height < bottom) y = Math.max(0, bottom - height);
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

async function saveShot(page, name, clip) {
  const path = join(shotDir, name);
  const buffer = await shoot(page, clip);
  await writeFile(path, buffer);
  console.log('wrote', path, `${outWidth}x${outHeight}`);
}

async function shoot(page, clip) {
  const buffer = await page.screenshot({ clip, type: 'png' });
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const expectWidth = Math.round(clip.width * scale);
  const expectHeight = Math.round(clip.height * scale);
  if (width !== expectWidth || height !== expectHeight) {
    throw new Error(`Shot is ${width}x${height}, expected ${expectWidth}x${expectHeight}`);
  }
  return buffer;
}

function cropOrigin(box, clip) {
  if (!box) return 0;
  const center = (box.x + box.width / 2 - clip.x) * scale;
  return Math.max(0, Math.min(outWidth - 640, Math.round(center - 320)));
}

async function stitchPair(left, right, leftCrop, rightCrop) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: outWidth, height: outHeight },
      deviceScaleFactor: 1,
    });
    const host = await context.newPage();
    await host.setContent(
      '<!doctype html><style>html,body{margin:0}div{width:640px;height:800px;overflow:hidden;display:inline-block}img{width:1280px;height:800px}</style><div><img id="l"></div><div><img id="r"></div>',
    );
    await host.locator('#l').evaluate((image, src) => {
      image.src = src;
    }, `data:image/png;base64,${left.toString('base64')}`);
    await host.locator('#r').evaluate((image, src) => {
      image.src = src;
    }, `data:image/png;base64,${right.toString('base64')}`);
    await host.locator('#l').evaluate((image, offset) => {
      image.style.marginLeft = `${-offset}px`;
    }, leftCrop);
    await host.locator('#r').evaluate((image, offset) => {
      image.style.marginLeft = `${-offset}px`;
    }, rightCrop);
    await host.locator('#r').evaluate((image) => image.decode());
    const buffer = await host.screenshot({ type: 'png' });
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== outWidth || height !== outHeight) {
      throw new Error(`Split shot is ${width}x${height}, expected ${outWidth}x${outHeight}`);
    }
    const path = join(shotDir, '02-only-payments.png');
    await writeFile(path, buffer);
    console.log('wrote', path, `${width}x${height}`);
  } finally {
    await browser.close();
  }
}

async function cursorOn(page, locator, badge) {
  await placeCursor(page, ...(await pointOf(locator, badge)));
}

async function cursorOnElement(page, element, badge) {
  await placeCursor(page, ...(await pointOf(element, badge)));
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

async function placeCursor(page, x, y) {
  await page.mouse.move(x, y);
  await page.evaluate(({ x: left, y: top }) => {
    let marker = document.getElementById('diffseek-shot-cursor');
    if (!marker) {
      marker = document.createElement('div');
      marker.id = 'diffseek-shot-cursor';
      marker.style.cssText = [
        'position:fixed',
        'width:28px',
        'height:28px',
        'border-radius:50%',
        'border:2px solid rgba(20,20,20,0.72)',
        'background:rgba(80,80,80,0.35)',
        'box-shadow:0 0 0 1px rgba(255,255,255,0.9)',
        'pointer-events:none',
        'z-index:2147483647',
        'transform:translate(-50%,-50%)',
      ].join(';');
      document.documentElement.append(marker);
    }
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;
  }, { x, y });
}

async function hideCursor(page) {
  await page.evaluate(() => document.getElementById('diffseek-shot-cursor')?.remove());
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
