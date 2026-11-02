/**
 * Runs inside the compose page, not in Node. compose() injects these
 * declarations as page globals, so they may use only the DOM and each other.
 */
import type {
  Note,
  PlacedLayer,
  Point,
  Route,
  Scene,
  Tag,
} from './canvas-types.ts';
import type { Box } from './config.ts';

type Attrs = Record<string, number | string>;
interface Paint { accent: string; corner: number; svg: SVGSVGElement; }

const svgNamespace = 'http://www.w3.org/2000/svg';

function appendBold(parent: ParentNode, text: string): void {
  const pattern = /\*\*(.+?)\*\*/gv;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    appendCode(parent, text.slice(cursor, index));
    const strong = document.createElement('strong');
    appendCode(strong, match[1] ?? '');
    parent.append(strong);
    cursor = index + match[0].length;
  }
  appendCode(parent, text.slice(cursor));
}

function appendCode(parent: ParentNode, text: string): void {
  const pattern = /`(.+?)`/gv;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    appendText(parent, text.slice(cursor, index));
    const code = document.createElement('code');
    code.textContent = match[1] ?? '';
    parent.append(code);
    cursor = index + match[0].length;
  }
  appendText(parent, text.slice(cursor));
}

function appendText(parent: ParentNode, text: string): void {
  if (text === '') return;
  parent.append(text);
}

function drawArrowhead(paint: Paint, from: Point, to: Point): void {
  const [fromX, fromY] = from;
  const [toX, toY] = to;
  const length = Math.hypot(toX - fromX, toY - fromY) || 1;
  const ux = (toX - fromX) / length;
  const uy = (toY - fromY) / length;
  const size = 11;
  const points = [
    [toX, toY],
    [toX - ux * size - uy * size * 0.5, toY - uy * size + ux * size * 0.5],
    [toX - ux * size + uy * size * 0.5, toY - uy * size - ux * size * 0.5],
  ];
  drawShape(paint, 'polygon', { fill: paint.accent, points: points.map((point) => point.join(',')).join(' ') });
}

function drawDot(paint: Paint, at: Point): void {
  drawShape(paint, 'circle', { cx: at[0], cy: at[1], fill: paint.accent, r: 3.5 });
}

function drawLayers(body: HTMLElement, layers: PlacedLayer[]): void {
  for (const layer of layers) {
    const box = document.createElement('div');
    box.className = 'layer';
    box.style.left = `${layer.left}px`;
    box.style.width = `${layer.width}px`;
    const image = document.createElement('img');
    image.src = layer.src;
    image.style.width = `${layer.width0 * layer.ratio}px`;
    image.style.height = `${layer.height0 * layer.ratio}px`;
    image.style.marginLeft = `${-(layer.x0 + layer.crop)}px`;
    image.style.marginTop = `${-layer.y0}px`;
    box.append(image);
    body.append(box);
    if (layer.left <= 0) continue;
    const divider = document.createElement('div');
    divider.className = 'divider';
    divider.style.left = `${layer.left}px`;
    body.append(divider);
  }
}

function drawMasks(body: HTMLElement, masks: Box[]): void {
  for (const mask of masks) {
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${mask.x}px;top:${mask.y}px;width:${mask.w}px;height:${mask.h}px;background:#fff`;
    body.append(box);
  }
}

// A route leaves the label edge named by `from` and aims at the ring centre.
function drawRoutes(paint: Paint, routes: Route[], label: HTMLElement): void {
  const rect = label.getBoundingClientRect();
  for (const route of routes) {
    const { cx, cy, r } = route.ring;
    const start = routeStart(paint, rect, route);
    const span = Math.hypot(cx - start[0], cy - start[1]) || 1;
    const end: Point = [cx - ((cx - start[0]) / span) * r, cy - ((cy - start[1]) / span) * r];
    const tip = 3;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
    const tipEnd: Point = [end[0] - ((end[0] - start[0]) / length) * tip, end[1] - ((end[1] - start[1]) / length) * tip];
    drawShape(paint, 'polyline', { fill: 'none', points: [start, tipEnd].map((point) => point.join(',')).join(' '), stroke: paint.accent, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': 2 });
    drawDot(paint, start);
    drawArrowhead(paint, start, end);
  }
}

function drawShape(paint: Paint, tag: string, attrs: Attrs): void {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  paint.svg.append(node);
}

/** A second leader from the label to the matching source lines. */
function drawSourceBox(paint: Paint, target: Box, rect: DOMRect): void {
  const pad = 3;
  // Stop a source box short of a label to its right.
  const gap = 14;
  const u = target.x < rect.left
    ? { ...target, w: Math.min(target.w, rect.left - gap - pad - target.x) }
    : target;
  drawShape(paint, 'rect', { fill: 'none', height: u.h + pad * 2, rx: 6, stroke: paint.accent, 'stroke-width': 2.5, width: u.w + pad * 2, x: u.x - pad, y: u.y - pad });
  // The second target may sit on either side of the label.
  const onLeft = u.x + u.w < rect.left;
  const ex = onLeft ? u.x + u.w + pad : u.x - pad;
  const ey = Math.max(u.y, Math.min(rect.top + rect.height / 2, u.y + u.h));
  const bx = onLeft ? rect.left : rect.right;
  const by = Math.max(rect.top + paint.corner, Math.min(ey, rect.bottom - paint.corner));
  drawShape(paint, 'line', { stroke: paint.accent, 'stroke-linecap': 'round', 'stroke-width': 2, x1: bx, x2: ex, y1: by, y2: ey });
  drawDot(paint, [bx, by]);
}

function drawTags(body: HTMLElement, tags: Tag[]): void {
  for (const item of tags) {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = item.text;
    tag.style.left = `${item.x}px`;
    tag.style.top = `${item.y}px`;
    const size = item.size ?? 0;
    if (size > 0) tag.style.fontSize = `${size}px`;
    if (item.center === true) tag.style.transform = 'translateX(-50%)';
    if (item.right === true) tag.style.transform = 'translateX(-100%)';
    body.append(tag);
  }
}

function drawTarget(paint: Paint, note: Note, t: Box, label: HTMLElement): void {
  const rect = label.getBoundingClientRect();
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const anchor = edgeAnchor(paint, rect, cx, cy);
  const start = note.shape === 'ring'
    ? ringStart(paint, t, anchor)
    : rectStart(paint, note, t, anchor);
  drawShape(paint, 'line', { stroke: paint.accent, 'stroke-linecap': 'round', 'stroke-width': 2, x1: start[0], x2: anchor[0], y1: start[1], y2: anchor[1] });
  drawDot(paint, anchor);
  // Arrowhead on the target end, pointing at the target.
  if (note.arrow === true) drawArrowhead(paint, anchor, start);
  if (note.target2) drawSourceBox(paint, note.target2, rect);
}

function edgeAnchor(paint: Paint, rect: DOMRect, x: number, y: number): Point {
  const { corner } = paint;
  const clampedX = Math.max(rect.left + corner, Math.min(x, rect.right - corner));
  const clampedY = Math.max(rect.top + corner, Math.min(y, rect.bottom - corner));
  if (x < rect.left) return [rect.left, clampedY];
  if (x > rect.right) return [rect.right, clampedY];
  if (y < rect.top) return [clampedX, rect.top];
  return [clampedX, rect.bottom];
}

function placeNotes(body: HTMLElement, notes: Note[]): HTMLElement[] {
  const labels: Record<string, HTMLElement> = {};
  const placed = notes.map((note) => {
    const label = document.createElement('div');
    label.className = 'note';
    const title = document.createElement('b');
    appendBold(title, note.title);
    label.append(title);
    // " / " breaks a line.
    const bodyText = note.body ?? '';
    if (bodyText !== '') {
      for (const line of bodyText.split(' / ')) {
        const sub = document.createElement('span');
        appendBold(sub, line);
        label.append(sub);
      }
    }
    body.append(label);
    if (note.id !== undefined && note.id !== '') labels[note.id] = label;
    return label;
  });
  // Labels hug their copy; a group shares the widest width.
  const widths: Record<string, number> = {};
  for (const [index, label] of placed.entries()) {
    const group = notes[index]?.group;
    if (group === undefined || group === '') continue;
    widths[group] = Math.max(widths[group] ?? 0, Math.ceil(label.getBoundingClientRect().width));
  }
  for (const [index, label] of placed.entries()) {
    const note = notes[index];
    if (note === undefined) continue;
    const group = note.group;
    const groupWidth = group === undefined || group === '' ? undefined : widths[group];
    positionNote(label, note, groupWidth, labels);
  }
  return placed;
}

function positionNote(
  label: HTMLElement,
  note: Note,
  groupWidth: number | undefined,
  labels: Record<string, HTMLElement>,
): void {
  if (groupWidth !== undefined) label.style.width = `${groupWidth}px`;
  const { height, width } = label.getBoundingClientRect();
  let left = note.at[0];
  if (note.align === 'center') left -= width / 2;
  else if (note.align === 'right') left -= width;
  if (note.within) left = Math.max(note.within[0] + 12, Math.min(left, note.within[1] - 12 - width));
  let top = note.middle === true ? note.at[1] - height / 2 : note.at[1];
  const above = note.below ? labels[note.below[0]] : undefined;
  if (note.below && above) top = above.getBoundingClientRect().bottom + note.below[1];
  label.style.left = `${Math.round(left)}px`;
  label.style.top = `${Math.round(top)}px`;
}

function rectStart(paint: Paint, note: Note, t: Box, anchor: Point): Point {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const [ax, ay] = anchor;
  const dx = ax - cx;
  const dy = ay - cy;
  const pad = 4;
  const hw = t.w / 2 + pad;
  const hh = t.h / 2 + pad;
  drawShape(paint, 'rect', { fill: 'none', height: hh * 2, rx: 8, stroke: paint.accent, 'stroke-width': 2.5, width: hw * 2, x: cx - hw, y: cy - hh });
  // Enter through the left edge, level with the label where possible.
  if (note.enter === 'left') return [cx - hw, Math.max(cy - hh + 10, Math.min(ay, cy + hh - 10))];
  // Leave through the top edge, toward the label's side.
  if (note.exit === 'top') return [Math.max(cx - hw + 10, Math.min(ax, cx + hw - 10)), cy - hh];
  const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return [cx + dx * k, cy + dy * k];
}

function renderScene(scene: Scene): void {
  const body = document.body;
  drawLayers(body, scene.layers);
  drawMasks(body, scene.masks);
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('width', '1280');
  svg.setAttribute('height', '800');
  body.append(svg);
  // A leader meets a label on a straight stretch of its edge, clear of
  // the rounded corners, so the dot never sits on a curve.
  const paint: Paint = { accent: scene.accent, corner: 14, svg };
  const placed = placeNotes(body, scene.notes);
  for (const [index, note] of scene.notes.entries()) {
    const label = placed[index];
    if (!label) continue;
    if (note.routes) drawRoutes(paint, note.routes, label);
    if (note.target) drawTarget(paint, note, note.target, label);
  }
  drawTags(body, scene.tags);
}

function ringStart(paint: Paint, t: Box, anchor: Point): Point {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const dx = anchor[0] - cx;
  const dy = anchor[1] - cy;
  const length = Math.hypot(dx, dy) || 1;
  const r = Math.max(t.w, t.h) / 2 + 6;
  drawShape(paint, 'circle', { cx, cy, fill: 'none', r, stroke: paint.accent, 'stroke-width': 2.5 });
  return [cx + (dx / length) * r, cy + (dy / length) * r];
}

/**
 * Offset pins the start: px from the label's left on the top edge, or
 * from its top on the right edge.
 */
function routeStart(paint: Paint, rect: DOMRect, route: Route): Point {
  const { corner } = paint;
  const { cx, cy } = route.ring;
  if (route.offset !== undefined) {
    if (route.from === 'right') return [rect.right, rect.top + route.offset];
    if (route.from === 'top') return [rect.left + route.offset, rect.top];
  }
  if (route.from === 'left') {
    return [rect.left, Math.max(rect.top + corner, Math.min(cy, rect.bottom - corner))];
  }
  return [cx < rect.left + corner ? rect.left + corner : Math.min(cx, rect.right - corner), rect.top];
}

/** Page script for compose(): every declaration above, then the entry point. */
export const canvasScript = [
  `const svgNamespace = ${JSON.stringify(svgNamespace)};`,
  appendText,
  appendCode,
  appendBold,
  drawLayers,
  drawMasks,
  drawShape,
  edgeAnchor,
  drawArrowhead,
  drawDot,
  placeNotes,
  positionNote,
  drawRoutes,
  routeStart,
  drawTarget,
  ringStart,
  rectStart,
  drawSourceBox,
  drawTags,
  renderScene,
]
  .map(String)
  .join('\n');

/** The page global that draws a scene once canvasScript is loaded. */
export const renderSceneName = renderScene.name;
