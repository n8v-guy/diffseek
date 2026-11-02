import { type BrowserContext, chromium, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import '../../src/adapters/browser/page-globals.ts';
import {
  changesUrl,
  extensionPath,
  type FilterDefaults,
  maxAttempts,
  quietDefaults,
  scale,
  shotDir,
  viewedActionSelector,
  viewport,
} from './config.ts';
import { waitForToasts } from './page.ts';

export async function openReview(page: Page): Promise<void> {
  // GitHub sometimes stalls a load of this large PR; one more try clears it.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(changesUrl, { timeout: 120_000, waitUntil: 'domcontentloaded' });
      await page.locator(viewedActionSelector).first().waitFor({ timeout: 60_000 });
      break;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      console.log('Review page did not load, retrying.');
    }
  }
  await waitForToasts(page);
}

/** Turn auto-view off in this profile and reload the PR. */
export async function quietProfile(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await writeDefaults(page.context(), quietDefaults);
  await openReview(page);
}

/** STORAGE_STATE: a Playwright storage-state JSON path. Never printed. */
export function storageStatePath(): string {
  const storageState = process.env['STORAGE_STATE'];
  if (storageState === undefined || storageState === '') {
    throw new Error('Set STORAGE_STATE to a Playwright storage state JSON path.');
  }
  return storageState;
}

/** Runs `run` on the demo PR in a fresh Chromium profile with the built extension. */
export async function withPage<T>(
  run: (page: Page) => Promise<T>,
  defaults: FilterDefaults | null = quietDefaults,
): Promise<T> {
  const userData = await mkdtemp(path.join(tmpdir(), 'diffseek-shot-'));
  const context = await chromium.launchPersistentContext(userData, {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    channel: 'chromium',
    deviceScaleFactor: scale,
    headless: process.env['HEADLESS'] !== '0',
    viewport,
  });
  try {
    return await runOnReview(context, run, defaults);
  } finally {
    await context.close();
    await rm(userData, { force: true, recursive: true });
  }
}

async function runOnReview<T>(
  context: BrowserContext,
  run: (page: Page) => Promise<T>,
  defaults: FilterDefaults | null,
): Promise<T> {
  type Cookies = Parameters<BrowserContext['addCookies']>[0];
  // Persistent contexts ignore the storageState option, so load the cookies by hand.
  const state = JSON.parse(await readFile(storageStatePath(), 'utf8')) as { cookies?: Cookies };
  await context.addCookies(state.cookies ?? []);
  if (defaults !== null) await writeDefaults(context, defaults);
  const page = context.pages()[0] ?? (await context.newPage());
  await openReview(page);
  try {
    return await run(page);
  } catch (error: unknown) {
    await saveFailureShot(page);
    throw error;
  }
}

async function saveFailureShot(page: Page): Promise<void> {
  try {
    await page.screenshot({ path: path.join(shotDir, 'debug-failure.png') });
  } catch {
    // A missing failure shot should not hide the original error.
  }
}

async function writeDefaults(context: BrowserContext, defaults: FilterDefaults): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    (value) => globalThis.chrome.storage.local.set({ 'diffseek:filter-defaults': value }),
    defaults,
  );
}
