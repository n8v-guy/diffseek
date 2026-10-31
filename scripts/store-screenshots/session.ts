import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';

import {
  changesUrl,
  extensionPath,
  quietDefaults,
  scale,
  shotDir,
  viewedActionSelector,
  viewport,
  type FilterDefaults,
} from './config.ts';
import { waitForToasts } from './page.ts';

type Cookies = Parameters<BrowserContext['addCookies']>[0];
type ExtensionGlobal = {
  chrome: { storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } } };
};

/** STORAGE_STATE: a Playwright storage-state JSON path. Never printed. */
export function storageStatePath(): string {
  const path = process.env.STORAGE_STATE;
  if (!path) {
    console.error('Set STORAGE_STATE to a Playwright storage state JSON path.');
    process.exit(1);
  }
  return path;
}

/** Runs `run` on the demo PR in a fresh Chromium profile with the built extension. */
export async function withPage<T>(
  run: (page: Page) => Promise<T>,
  defaults: FilterDefaults | null = quietDefaults,
): Promise<T> {
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
    const state = JSON.parse(await readFile(storageStatePath(), 'utf8')) as { cookies?: Cookies };
    await context.addCookies(state.cookies ?? []);
    if (defaults) await writeDefaults(context, defaults);
    const page = context.pages()[0] ?? (await context.newPage());
    await openReview(page);
    return await run(page).catch(async (error: unknown) => {
      await page.screenshot({ path: join(shotDir, 'debug-failure.png') }).catch(() => undefined);
      throw error;
    });
  } finally {
    await context.close();
    await rm(userData, { recursive: true, force: true });
  }
}

async function writeDefaults(context: BrowserContext, defaults: FilterDefaults): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    (value) => (globalThis as unknown as ExtensionGlobal).chrome.storage.local.set({ 'diffseek:filter-defaults': value }),
    defaults,
  );
}

export async function openReview(page: Page): Promise<void> {
  // GitHub sometimes stalls a load of this large PR; one more try clears it.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(changesUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.locator(viewedActionSelector).first().waitFor({ timeout: 60_000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
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
