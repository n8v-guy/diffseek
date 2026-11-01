import type { Note, Ring } from './canvas-types.ts';
import type {
  NoiseCutCapture,
  OnlySplitCapture,
  ViewedBadgesCapture,
} from './captures.ts';
import { compose } from './compose.ts';
import { outHeight, outWidth, type Box } from './config.ts';
import type { SourceKey, SourcesCapture } from './sources.ts';

export async function noiseCutLayout({ shot, signs, pillBox, menuBox }: NoiseCutCapture): Promise<void> {
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

export async function onlySplitLayout({ beforeShot, afterShot, beforeCrop, afterCrop, onlyBox, allBox, resetBox }: OnlySplitCapture): Promise<void> {
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
      { target: onlyBox, shape: 'rect', at: [Math.round(onlyBox.x + onlyBox.w + 100), Math.round(onlyBox.y - 68)], within: [0, 640], exit: 'top', title: 'only', body: 'Just this owner, group or format.' },
      { target: allBox, shape: 'rect', at: [Math.round(allBox.x + allBox.w + 40), Math.round(allBox.y + allBox.h / 2)], middle: true, within: [640, outWidth], title: 'all', body: 'The whole section again.' },
      { target: resetBox, shape: 'rect', at: [Math.round(resetBox.x + resetBox.w + 28), Math.round(resetBox.y + resetBox.h / 2)], middle: true, within: [640, outWidth], title: 'Restore all sections' },
    ],
  });
}

export async function viewedBadgesLayout({ shot, boxes }: ViewedBadgesCapture): Promise<void> {
  const treeAt: [number, number] = [Math.round(boxes.folder.x + 90), Math.round(boxes.folder.y - 34)];
  const menuAt: [number, number] = [Math.round(boxes.menu.x + boxes.menu.w + 34), Math.round(boxes.circle.y + 20)];
  const ringOf = (box: Box): Ring => ({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, r: Math.max(box.w, box.h) / 2 + 6 });
  const folderRing = ringOf(boxes.folder);
  const clickAt: [number, number] = [Math.round(boxes.menu.x - 262), Math.round(boxes.folder.y + 236)];
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

export async function sourcesSplitLayout({ sourceShot, menuShot, menuLeft, menuCrop, menuFrame, menuRows, source }: SourcesCapture): Promise<void> {
  // One column of labels, right-aligned against the menu and all one width.
  const labelRight = menuLeft - 12;
  const note = (key: SourceKey, title: string, body: string, extra: Partial<Note> = {}): Note => ({
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
