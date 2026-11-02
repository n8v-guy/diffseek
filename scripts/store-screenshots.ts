#!/usr/bin/env -S node --experimental-strip-types
import type { Page } from '@playwright/test';

/**
 * Store screenshots for https://github.com/sha-tm/diffseek-test-data/pull/2.
 *
 *   pnpm build
 *   STORAGE_STATE=/path/to/state.json pnpm store-screenshots
 *
 * STORAGE_STATE is a Playwright storage-state JSON file. The script never
 * prints it. Each shot uses a fresh Chromium profile with the built extension.
 * Shots 2-4 turn auto-view off in that profile first, so the PR stays at its
 * 12/82 baseline. Viewed checkboxes live on GitHub, so shot 1, which changes
 * them, restores the baseline before the browser closes.
 *
 * SHOTS=1,3 takes some shots only. REPLAY=1 redraws the callouts from the
 * kept capture-N.json files without opening GitHub. BASELINE=1 only restores
 * the 12/82 baseline and checks it file by file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { restoreAndVerify, restoreBaseline } from './store-screenshots/baseline.ts';
import {
  noiseCut,
  type NoiseCutCapture,
  onlySplit,
  viewedBadges,
} from './store-screenshots/captures.ts';
import { shotDir, shots } from './store-screenshots/config.ts';
import {
  noiseCutLayout,
  onlySplitLayout,
  sourcesSplitLayout,
  viewedBadgesLayout,
} from './store-screenshots/layouts.ts';
import { quietProfile, storageStatePath, withPage } from './store-screenshots/session.ts';
import { sourcesSplit } from './store-screenshots/sources.ts';

const replay = Boolean(process.env['REPLAY']);

async function firstRun(page: Page): Promise<NoiseCutCapture> {
  try {
    return await noiseCut(page);
  } finally {
    // Turn auto-view off first, or the restore's reload marks the generated files again.
    await quietProfile(page);
    await restoreBaseline(page);
  }
}

/**
 * Captures a shot on GitHub, keeps the capture next to the shots, then draws
 * the callouts. REPLAY=1 redraws from the kept capture without opening GitHub.
 */
async function stage<T>(id: string, capture: () => Promise<T>, layout: (data: T) => Promise<void>): Promise<void> {
  const file = path.join(shotDir, `capture-${id}.json`);
  let data: T;
  if (replay) {
    data = JSON.parse(await readFile(file, 'utf8')) as T;
  } else {
    data = await capture();
    await writeFile(file, JSON.stringify(data));
  }
  await layout(data);
}

if (!replay) storageStatePath();
await mkdir(shotDir, { recursive: true });
const baselineOnly = process.env['BASELINE'];
if (baselineOnly === undefined || baselineOnly === '') {
  console.log('Shots land in', shotDir);
  for (const [file, caption] of shots) console.log(`${file} — ${caption}`);

  const pick = new Set((process.env['SHOTS'] ?? '1,2,3,4').split(',').map((part) => part.trim()));
  if (pick.has('1')) await stage('1', () => withPage(firstRun, null), noiseCutLayout);
  if (pick.has('2')) await stage('2', () => withPage(onlySplit), onlySplitLayout);
  if (pick.has('3')) await stage('3', () => withPage(viewedBadges), viewedBadgesLayout);
  if (pick.has('4')) await stage('4', () => withPage(sourcesSplit), sourcesSplitLayout);
} else {
  await restoreAndVerify();
}
