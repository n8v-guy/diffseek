#!/usr/bin/env -S node --experimental-strip-types
/**
 * Icons are rendered from the committed SVGs at build time, so no PNG is
 * committed and the AMO sources archive rebuilds them byte for byte.
 *
 *   pnpm store-icon   # writes the Chrome Web Store icon to .output/
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import type { CopiedPublicFile } from 'wxt';

// icon-low.svg is drawn on a 16 px grid; icon.svg blurs below 48 px.
const sources = [
  [16, 'icon-low.svg'],
  [32, 'icon-low.svg'],
  [48, 'icon.svg'],
  [96, 'icon.svg'],
  [128, 'icon.svg'],
] as const;
const iconPath = (size: number) => `icons/${size}.png`;

export const manifestIcons = Object.fromEntries(
  sources.map(([size]) => [size, iconPath(size)]),
);

async function render(source: string, size: number, viewBox?: string) {
  let svg = await readFile(join('assets', source), 'utf8');
  if (viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
}

async function write(file: string, png: Buffer) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, png);
}

/** Renders the manifest icons under `dir` as public files to copy. */
export function renderIcons(dir: string): Promise<CopiedPublicFile[]> {
  return Promise.all(
    sources.map(async ([size, source]) => {
      const relativeDest = iconPath(size);
      const absoluteSrc = join(dir, relativeDest);
      await write(absoluteSrc, await render(source, size));
      return { absoluteSrc, relativeDest };
    }),
  );
}

async function main() {
  // The tile spans 112 of icon.svg's 128 units. The store wants 96 px of art
  // centred in 128 px, so widen the viewBox until the tile is 96/128 of it.
  const span = (128 * 112) / 96;
  const origin = (128 - span) / 2;
  const file = '.output/store-icon.png';
  await write(file, await render('icon.svg', 128, `${origin} ${origin} ${span} ${span}`));
  console.log(file);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
