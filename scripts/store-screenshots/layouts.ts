import type { Note, Point } from './canvas-types.ts';
import type {
  NoiseCutCapture,
  OnlySplitCapture,
  ViewedBadgesCapture,
} from './captures.ts';
import type { SourceKey, SourcesCapture } from './sources.ts';

import { centerOf, ringOf } from './canvas.ts';
import { compose } from './compose.ts';
import { halfWidth, outHeight, outWidth } from './config.ts';

export async function noiseCutLayout({ menuBox, pillBox, shot, signs }: NoiseCutCapture): Promise<void> {
  const [center] = centerOf(signs);
  const signsLabelRise = 140;
  await compose('01-noise-cut.png', {
    layers: [{ crop: 0, left: 0, shot, width: outWidth }],
    notes: [
      // Centred on the signs, so the leader drops straight onto them.
      { align: 'center', at: [center, Math.round(signs.y - signsLabelRise)], body: 'Viewed and generated files stay out of the way. / Click the row to change the default.', shape: 'rect', target: signs, title: 'Hidden by default' },
      { at: offset([menuBox.x + menuBox.w, pillBox.y], { dx: 36, dy: 56 }), body: 'Marked viewed automatically. / Toggle to change.', shape: 'rect', target: pillBox, title: 'Auto-view by default' },
    ],
    tags: [],
  });
}

export async function onlySplitLayout({ afterCrop, afterShot, allBox, beforeCrop, beforeShot, onlyBox, resetBox }: OnlySplitCapture): Promise<void> {
  await compose('02-only.png', {
    layers: [
      { crop: beforeCrop, left: 0, shot: beforeShot, width: halfWidth },
      { crop: afterCrop, left: halfWidth, shot: afterShot, width: halfWidth },
    ],
    notes: [
      // Each label stays inside its own half, right of the menu. The "only"
      // leader rises over the empty end of the Owners title, and the "all"
      // leader runs level, so neither crosses a count.
      { at: offset([onlyBox.x + onlyBox.w, onlyBox.y], { dx: 100, dy: -68 }), body: 'Just this owner, group or format.', exit: 'top', shape: 'rect', target: onlyBox, title: 'only', within: [0, halfWidth] },
      { at: offset([allBox.x + allBox.w, centerOf(allBox)[1]], { dx: 40 }), body: 'The whole section again.', middle: true, shape: 'rect', target: allBox, title: 'all', within: [halfWidth, outWidth] },
      // Level with the icon, right of the menu: below the After tag and
      // above the "all" label.
      { at: offset([resetBox.x + resetBox.w, centerOf(resetBox)[1]], { dx: 28 }), middle: true, shape: 'rect', target: resetBox, title: 'Restore all sections', within: [halfWidth, outWidth] },
    ],
    tags: [
      { center: true, size: 25.5, text: 'Before', x: 320, y: 10 },
      { center: true, size: 25.5, text: 'After “only”', x: 960, y: 10 },
    ],
  });
}

export async function sourcesSplitLayout({ menuCrop, menuFrame, menuLeft, menuRows, menuShot, source, sourceShot }: SourcesCapture): Promise<void> {
  // One column of labels, right-aligned against the menu and all one width.
  const labelGap = 12;
  const labelRight = menuLeft - labelGap;
  const labelColumn = 210;
  const note = (key: SourceKey, fields: Partial<Note> & Pick<Note, 'title'>): Note => ({
    align: 'right',
    arrow: true,
    at: [labelRight, Math.round(centerOf(source[key])[1])],
    group: 'sources',
    middle: true,
    shape: 'rect',
    target: menuRows[key],
    target2: source[key],
    ...fields,
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
      note('payments', { body: 'from `CODEOWNERS`', enter: 'left', title: 'Owners' }),
      note('generated', { body: '`linguist-generated` paths', title: 'Generated' }),
      note('tests', { body: 'your own `group=` attribute', title: 'Groups' }),
      note('typescript', { body: '`linguist-language` overrides', enter: 'left', id: 'formats', title: 'Languages' }),
      // No config line feeds these rows, so this label has no source box. It
      // sits under the Formats label, so the two arrows run side by side.
      {
        align: 'right',
        arrow: true,
        at: [labelRight, 0],
        below: { gap: 14, id: 'formats' },
        body: 'labeled by file extension',
        enter: 'left',
        group: 'sources',
        shape: 'rect',
        target: menuRows.other,
        title: 'Other formats',
      },
    ],
    tags: [
      { center: true, text: 'Repository files', x: Math.round((menuLeft - labelColumn) / 2), y: 742 },
      // Clear of the menu rows: in the label column, against the menu edge.
      { right: true, text: 'DiffSeek menu', x: labelRight, y: 742 },
    ],
  });
}

export async function viewedBadgesLayout({ boxes, shot }: ViewedBadgesCapture): Promise<void> {
  const treeAt = offset([boxes.folder.x, boxes.folder.y], { dx: 90, dy: -34 });
  const menuAt = offset([boxes.menu.x + boxes.menu.w, boxes.circle.y], { dx: 34, dy: 20 });
  const folderRing = ringOf(boxes.folder);
  // The third label sits over the tree, just left of the menu, between the
  // PaymentMethodsPage.test.tsx row and the featureFlags.ts row (tree rows are
  // 32 CSS px apart), so it only hides the tail of one file name. Both arrows
  // are single straight segments. The one to the folder ring leaves the
  // label's top right and climbs through the blank space right of the names,
  // under the File tree label. The one to the menu badge leaves the label's
  // right edge and crosses the menu in the empty gap between the App and
  // Config rows, under the web-platform count.
  const clickAt = offset([boxes.menu.x, boxes.folder.y], { dx: -262, dy: 236 });
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

/** A label spot offset from a reference point, on whole pixels. */
function offset([x, y]: Point, { dx = 0, dy = 0 }: { dx?: number; dy?: number }): Point {
  return [Math.round(x + dx), Math.round(y + dy)];
}
