import type { Note, Ring } from './canvas-types.ts';
import type {
  NoiseCutCapture,
  OnlySplitCapture,
  ViewedBadgesCapture,
} from './captures.ts';
import type { SourceKey, SourcesCapture } from './sources.ts';

import { compose } from './compose.ts';
import { type Box, outHeight, outWidth } from './config.ts';

export async function noiseCutLayout({ menuBox, pillBox, shot, signs }: NoiseCutCapture): Promise<void> {
  const center = signs.x + signs.w / 2;
  await compose('01-noise-cut.png', {
    layers: [{ crop: 0, left: 0, shot, width: outWidth }],
    notes: [
      // Centred on the signs, so the leader drops straight onto them.
      { align: 'center', at: [center, Math.round(signs.y - 140)], body: 'Viewed and generated files stay out of the way. / Click the row to change the default.', shape: 'rect', target: signs, title: 'Hidden by default' },
      { at: [Math.round(menuBox.x + menuBox.w + 36), Math.round(pillBox.y + 56)], body: 'Marked viewed automatically. / Toggle to change.', shape: 'rect', target: pillBox, title: 'Auto-view by default' },
    ],
    tags: [],
  });
}

export async function onlySplitLayout({ afterCrop, afterShot, allBox, beforeCrop, beforeShot, onlyBox, resetBox }: OnlySplitCapture): Promise<void> {
  await compose('02-only.png', {
    layers: [
      { crop: beforeCrop, left: 0, shot: beforeShot, width: 640 },
      { crop: afterCrop, left: 640, shot: afterShot, width: 640 },
    ],
    notes: [
      // Each label stays inside its own half, right of the menu. The "only"
      // leader rises over the empty end of the Owners title, and the "all"
      // leader runs level, so neither crosses a count.
      { at: [Math.round(onlyBox.x + onlyBox.w + 100), Math.round(onlyBox.y - 68)], body: 'Just this owner, group or format.', exit: 'top', shape: 'rect', target: onlyBox, title: 'only', within: [0, 640] },
      { at: [Math.round(allBox.x + allBox.w + 40), Math.round(allBox.y + allBox.h / 2)], body: 'The whole section again.', middle: true, shape: 'rect', target: allBox, title: 'all', within: [640, outWidth] },
      // Level with the icon, right of the menu: below the After tag and
      // above the "all" label.
      { at: [Math.round(resetBox.x + resetBox.w + 28), Math.round(resetBox.y + resetBox.h / 2)], middle: true, shape: 'rect', target: resetBox, title: 'Restore all sections', within: [640, outWidth] },
    ],
    tags: [
      { center: true, size: 25.5, text: 'Before', x: 320, y: 10 },
      { center: true, size: 25.5, text: 'After “only”', x: 960, y: 10 },
    ],
  });
}

export async function sourcesSplitLayout({ menuCrop, menuFrame, menuLeft, menuRows, menuShot, source, sourceShot }: SourcesCapture): Promise<void> {
  // One column of labels, right-aligned against the menu and all one width.
  const labelRight = menuLeft - 12;
  const note = (key: SourceKey, title: string, body: string, extra: Partial<Note> = {}): Note => ({
    align: 'right',
    arrow: true,
    at: [labelRight, Math.round(source[key].y + source[key].h / 2)],
    body,
    group: 'sources',
    middle: true,
    shape: 'rect',
    target: menuRows[key],
    target2: source[key],
    title,
    ...extra,
  });
  await compose('04-sources.png', {
    layers: [
      { crop: 0, left: 0, shot: sourceShot, width: menuLeft },
      { crop: menuCrop, left: menuLeft, shot: menuShot, width: outWidth - menuLeft },
    ],
    // Clean white margins around the menu: no GitHub page peeks out.
    masks: [
      { h: outHeight, w: Math.max(0, Math.floor(menuFrame.x) - menuLeft - 2), x: menuLeft + 2, y: 0 },
      { h: outHeight, w: outWidth, x: Math.ceil(menuFrame.x + menuFrame.w), y: 0 },
      { h: outHeight, w: outWidth, x: menuLeft + 2, y: Math.ceil(menuFrame.y + menuFrame.h) },
      { h: Math.max(0, Math.floor(menuFrame.y)), w: outWidth, x: menuLeft + 2, y: 0 },
    ],
    notes: [
      note('payments', 'Owners', 'from `CODEOWNERS`', { enter: 'left' }),
      note('generated', 'Generated', '`linguist-generated` paths'),
      note('tests', 'Groups', 'your own `group=` attribute'),
      note('typescript', 'Languages', '`linguist-language` overrides', { enter: 'left', id: 'formats' }),
      // No config line feeds these rows, so this label has no source box. It
      // sits under the Formats label, so the two arrows run side by side.
      {
        align: 'right',
        arrow: true,
        at: [labelRight, 0],
        below: ['formats', 14],
        body: 'labeled by file extension',
        enter: 'left',
        group: 'sources',
        shape: 'rect',
        target: menuRows.other,
        title: 'Other formats',
      },
    ],
    tags: [
      { center: true, text: 'Repository files', x: Math.round((menuLeft - 210) / 2), y: 742 },
      // Clear of the menu rows: in the label column, against the menu edge.
      { right: true, text: 'DiffSeek menu', x: labelRight, y: 742 },
    ],
  });
}

export async function viewedBadgesLayout({ boxes, shot }: ViewedBadgesCapture): Promise<void> {
  const treeAt: [number, number] = [Math.round(boxes.folder.x + 90), Math.round(boxes.folder.y - 34)];
  const menuAt: [number, number] = [Math.round(boxes.menu.x + boxes.menu.w + 34), Math.round(boxes.circle.y + 20)];
  const ringOf = (box: Box): Ring => ({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, r: Math.max(box.w, box.h) / 2 + 6 });
  const folderRing = ringOf(boxes.folder);
  // The third label sits over the tree, just left of the menu, between the
  // PaymentMethodsPage.test.tsx row and the featureFlags.ts row (tree rows are
  // 32 CSS px apart), so it only hides the tail of one file name. Both arrows
  // are single straight segments. The one to the folder ring leaves the
  // label's top right and climbs through the blank space right of the names,
  // under the File tree label. The one to the menu badge leaves the label's
  // right edge and crosses the menu in the empty gap between the App and
  // Config rows, under the web-platform count.
  const clickAt: [number, number] = [Math.round(boxes.menu.x - 262), Math.round(boxes.folder.y + 236)];
  await compose('03-viewed-badges.png', {
    layers: [{ crop: 0, left: 0, shot, width: outWidth }],
    notes: [
      { at: treeAt, body: 'Progress over the files **shown** / ○ none · ◐ some · ● all', id: 'tree', shape: 'ring', target: boxes.folder, title: 'File tree badges' },
      { at: menuAt, body: 'Progress over the **whole** category, / hidden ones included', id: 'menu', shape: 'ring', target: boxes.circle, title: 'Menu badges' },
      {
        at: clickAt,
        body: 'files viewed, click again to unmark',
        routes: [
          { from: 'top', offset: 220, ring: folderRing },
          { from: 'right', offset: 15, ring: ringOf(boxes.circle) },
        ],
        title: 'Click any badge to mark',
      },
    ],
    tags: [],
  });
}
