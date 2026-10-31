import type { ElementHandle, Locator, Page } from '@playwright/test';

import {
  menuSelector,
  outWidth,
  scale,
  viewport,
  type Box,
  type Clip,
  type Rect,
  type Shot,
} from './config.ts';

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function viewportOf(page: Page): { width: number; height: number } {
  return page.viewportSize() ?? viewport;
}

/**
 * GitHub's menu only re-anchors to its button after a resize or a capture,
 * not after a scroll. Nudge it into place before anything is measured.
 */
export async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  await page.screenshot({ type: 'png' });
  await page.waitForTimeout(300);
}

function layoutProbe(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const menu = document.querySelector(selector)?.getBoundingClientRect();
    return [scrollX, scrollY, Math.round(menu?.x ?? -1), Math.round(menu?.y ?? -1)].join(',');
  }, menuSelector);
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
  const { width, height } = pngSize(buffer);
  if (width !== Math.round(size.width * scale) || height !== Math.round(size.height * scale)) {
    throw new Error(`Shot is ${width}x${height}, expected the ${size.width}x${size.height} viewport at ${scale}x`);
  }
  // Base64, so a capture can be kept as JSON and replayed.
  return { png: buffer.toString('base64'), clip, width, height };
}

/** The viewed circle is painted by ::before; return that disc's box. */
export function discOf(target: ElementHandle | Locator): Promise<Rect> {
  const measure = (element: Element): Rect => {
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
  };
  return 'waitFor' in target ? target.evaluate(measure) : target.evaluate(measure);
}

/** Maps a page box (or an element's box) into output canvas pixels. */
export async function outBox(
  target: ElementHandle | Locator | Rect | null,
  clip: Clip,
  crop: number,
  left: number,
): Promise<Box> {
  const box = target && 'boundingBox' in target ? await target.boundingBox() : target;
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
export function halfCrop(menuBox: Rect | null, clip: Clip): number {
  if (!menuBox) throw new Error('The filter menu is off screen');
  const left = (menuBox.x - clip.x) * scale;
  return Math.max(0, Math.min(outWidth - 640, Math.round(left - 16)));
}

/** A clip of the given size that holds every subject. */
export async function frame(
  page: Page,
  locators: Locator[],
  width: number,
  height: number,
  pad = 12,
): Promise<Clip> {
  const [first] = locators;
  if (!first) throw new Error('A frame needs a subject');
  await first.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
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
      `Subjects span ${Math.ceil(right - left)}x${Math.ceil(bottom - top)} CSS px and the clip is ${Math.round(width)}x${Math.round(height)}: ${JSON.stringify(boxes.map((box) => [Math.round(box.x), Math.round(box.y)]))}`,
    );
  }
  const size = viewportOf(page);
  let x = Math.min(Math.max(0, left - 16), size.width - width);
  let y = Math.min(Math.max(0, top - pad), size.height - height);
  if (x + width < right) x = Math.max(0, right - width);
  if (y + height < bottom) y = Math.max(0, bottom - height);
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

/** A full-width clip from the top of the viewport at the given zoom. */
export function fullWidthClip(page: Page, zoom: number, height: number): Clip {
  const width = outWidth / zoom;
  const size = viewportOf(page);
  return { x: size.width - width, y: 0, width, height: height / zoom, zoom };
}
