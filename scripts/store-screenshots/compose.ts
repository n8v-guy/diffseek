import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

import type { Layer, Note, Scene, Tag } from './canvas-types.ts';
import { canvasScript, renderSceneName } from './canvas.ts';
import {
  accent,
  outHeight,
  outWidth,
  scale,
  shotDir,
  type Box,
} from './config.ts';
import { pngSize } from './geometry.ts';

type Composition = { layers: Layer[]; masks?: Box[]; tags: Tag[]; notes: Note[] };

const pageStyle = `<!doctype html><style>
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
    </style><body></body>`;

/**
 * Lays out shot crops on a 1280x800 canvas and draws callouts on top:
 * an outline on the target, a thin leader line, and a white label.
 */
export async function compose(
  name: string,
  { layers, masks = [], tags, notes }: Composition,
): Promise<void> {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: outWidth, height: outHeight },
      deviceScaleFactor: 1,
    });
    const host = await context.newPage();
    await host.setContent(pageStyle);
    await host.addScriptTag({ content: canvasScript });
    const scene: Scene = {
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
    };
    await host.evaluate(
      ({ entry, value }) => {
        const render = (globalThis as unknown as Record<string, (scene: unknown) => void>)[entry];
        if (!render) throw new Error(`${entry} is not loaded`);
        render(value);
      },
      { entry: renderSceneName, value: scene },
    );
    await host.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    await host.evaluate(() => document.fonts.ready);
    const buffer = await host.screenshot({ type: 'png' });
    const { width, height } = pngSize(buffer);
    if (width !== outWidth || height !== outHeight) {
      throw new Error(`Annotated shot is ${width}x${height}, expected ${outWidth}x${outHeight}`);
    }
    await writeFile(join(shotDir, name), buffer);
    console.log('wrote', join(shotDir, name), `${width}x${height}`);
  } finally {
    await browser.close();
  }
}
