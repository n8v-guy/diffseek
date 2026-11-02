import type { ElementHandle, Locator, Page } from '@playwright/test';

import {
  type Box,
  type Clip,
  gutter,
  halfWidth,
  menuSelector,
  outWidth,
  type Rect,
  scale,
  settlePause,
  type Shot,
  viewport,
} from './config.ts';

interface FrameSize { height: number; pad: number; width: number }
/** Where a capture lands on the canvas: `crop` px cut from its left, then shifted `left`. */
interface Placement { crop?: number; left?: number }

// Byte offsets of the width and height in a PNG's IHDR chunk.
const pngWidthOffset = 16;
const pngHeightOffset = 20;

/** The viewed circle is painted by ::before; return that disc's box. */
export function discOf(target: ElementHandle | Locator): Promise<Rect> {
  type Measure = (element: Element) => Rect;
  const evaluate = target.evaluate.bind(target) as (pageFunction: Measure) => Promise<Rect>;
  return evaluate(measureDisc);
}

/** "WxH", as messages print a size. */
export function formatSize(width: number, height: number): string {
  return `${String(width)}x${String(height)}`;
}

/** A clip of the given size that holds every subject. */
export async function frame(
  page: Page,
  locators: Locator[],
  size: FrameSize,
): Promise<Clip> {
  const { height, pad, width } = size;
  const [first] = locators;
  if (!first) throw new Error('A frame needs a subject');
  await first.evaluate((element) => { element.scrollIntoView({ block: 'start', inline: 'nearest' }); });
  for (const locator of locators) await locator.scrollIntoViewIfNeeded();
  await settleLayout(page);
  const boxes: Rect[] = [];
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
      `Subjects span ${formatSize(Math.ceil(right - left), Math.ceil(bottom - top))} CSS px and the clip is ${formatSize(Math.round(width), Math.round(height))}: ${JSON.stringify(boxes.map((box) => [Math.round(box.x), Math.round(box.y)]))}`,
    );
  }
  const viewportSize = viewportOf(page);
  let x = Math.min(Math.max(0, left - gutter), viewportSize.width - width);
  let y = Math.min(Math.max(0, top - pad), viewportSize.height - height);
  if (x + width < right) x = Math.max(0, right - width);
  if (y + height < bottom) y = Math.max(0, bottom - height);
  return { height, width, x: Math.max(0, x), y: Math.max(0, y) };
}

/** A full-width clip from the top of the viewport at the given zoom. */
export function fullWidthClip(page: Page, zoom: number, height: number): Clip {
  const width = outWidth / zoom;
  const size = viewportOf(page);
  return { height: height / zoom, width, x: size.width - width, y: 0, zoom };
}

/** Left offset that puts the menu 16px from the left of a 640px half. */
export function halfCrop(menuBox: null | Rect, clip: Clip): number {
  if (!menuBox) throw new Error('The filter menu is off screen');
  const left = (menuBox.x - clip.x) * scale;
  return Math.max(0, Math.min(outWidth - halfWidth, Math.round(left - gutter)));
}

/** Maps a page box (or an element's box) into output canvas pixels. */
export async function outBox(
  target: ElementHandle | Locator | null | Rect,
  clip: Clip,
  { crop = 0, left = 0 }: Placement = {},
): Promise<Box> {
  const box = target && 'boundingBox' in target ? await target.boundingBox() : target;
  if (!box) throw new Error('An annotated element is off screen');
  // A clip may carry its own zoom; the capture is still at `scale`.
  const zoom = clip.zoom ?? scale;
  return {
    h: box.height * zoom,
    w: box.width * zoom,
    x: left + (box.x - clip.x) * zoom - crop,
    y: (box.y - clip.y) * zoom,
  };
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buffer: Buffer): { height: number; width: number; } {
  return { height: buffer.readUInt32BE(pngHeightOffset), width: buffer.readUInt32BE(pngWidthOffset) };
}

/**
 * GitHub's menu only re-anchors to its button after a resize or a capture,
 * not after a scroll. Nudge it into place before anything is measured.
 */
export async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { Event, window } = globalThis;
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(settlePause);
  await page.screenshot({ type: 'png' });
  await page.waitForTimeout(settlePause);
}

/**
 * Captures the whole viewport and crops later. A clipped capture can make
 * Chromium resize the page for a moment, and GitHub's menu jumps when it does.
 */
export async function shoot(page: Page, clip: Clip): Promise<Shot> {
  const before = await layoutProbe(page);
  const buffer = await page.screenshot({ type: 'png' });
  const after = await layoutProbe(page);
  if (before !== after) throw new Error(`Layout moved during capture: ${before} -> ${after}`);
  const size = viewportOf(page);
  const { height, width } = pngSize(buffer);
  if (width !== Math.round(size.width * scale) || height !== Math.round(size.height * scale)) {
    throw new Error(`Shot is ${formatSize(width, height)}, expected the ${formatSize(size.width, size.height)} viewport at ${String(scale)}x`);
  }
  // Base64, so a capture can be kept as JSON and replayed.
  return { clip, height, png: buffer.toString('base64'), width };
}

function layoutProbe(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const { document, scrollX, scrollY } = globalThis;
    const menu = document.querySelector(selector)?.getBoundingClientRect();
    return [scrollX, scrollY, Math.round(menu?.x ?? -1), Math.round(menu?.y ?? -1)].join(',');
  }, menuSelector);
}

function measureDisc(element: Element): Rect {
  const cssLengthPattern = /^\s*[+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+\-]?\d+)?/iv;
  const cssLength = (value: string): number =>
    Number(cssLengthPattern.exec(value)?.[0] ?? NaN);
  const rect = element.getBoundingClientRect();
  const before = getComputedStyle(element, '::before');
  const width = cssLength(before.width) || rect.width;
  const height = cssLength(before.height) || rect.height;
  if (before.position !== 'absolute') {
    return { height, width, x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2 };
  }
  const right = cssLength(before.right);
  const bottom = cssLength(before.bottom);
  const left = cssLength(before.left);
  const top = cssLength(before.top);
  const x = Number.isFinite(left) ? rect.left + left : rect.right - (right || 0) - width;
  const y = Number.isFinite(top) ? rect.top + top : rect.bottom - (bottom || 0) - height;
  return { height, width, x, y };
}

function viewportOf(page: Page): { height: number; width: number; } {
  return page.viewportSize() ?? viewport;
}
