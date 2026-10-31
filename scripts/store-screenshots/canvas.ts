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

type Paint = { svg: SVGSVGElement; accent: string; corner: number };
type Attrs = Record<string, number | string>;

function renderScene(scene: Scene): void {
  const body = document.body;
  drawLayers(body, scene.layers);
  drawMasks(body, scene.masks);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '1280');
  svg.setAttribute('height', '800');
  body.append(svg);
  // A leader meets a label on a straight stretch of its edge, clear of
  // the rounded corners, so the dot never sits on a curve.
  const paint: Paint = { svg, accent: scene.accent, corner: 14 };
  const placed = placeNotes(body, scene.notes);
  for (const [index, note] of scene.notes.entries()) {
    const label = placed[index];
    if (!label) continue;
    if (note.routes) drawRoutes(paint, note.routes, label);
    if (note.target) drawTarget(paint, note, note.target, label);
  }
  drawTags(body, scene.tags);
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
    if (layer.left > 0) {
      const divider = document.createElement('div');
      divider.className = 'divider';
      divider.style.left = `${layer.left}px`;
      body.append(divider);
    }
  }
}

function drawMasks(body: HTMLElement, masks: Box[]): void {
  for (const mask of masks) {
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${mask.x}px;top:${mask.y}px;width:${mask.w}px;height:${mask.h}px;background:#fff`;
    body.append(box);
  }
}

function drawShape(paint: Paint, tag: string, attrs: Attrs): void {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  paint.svg.append(node);
}

function edgeAnchor(paint: Paint, rect: DOMRect, x: number, y: number): Point {
  const { corner } = paint;
  const clampX = (value: number) => Math.max(rect.left + corner, Math.min(value, rect.right - corner));
  const clampY = (value: number) => Math.max(rect.top + corner, Math.min(value, rect.bottom - corner));
  if (x < rect.left) return [rect.left, clampY(y)];
  if (x > rect.right) return [rect.right, clampY(y)];
  if (y < rect.top) return [clampX(x), rect.top];
  return [clampX(x), rect.bottom];
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
  drawShape(paint, 'polygon', { points: points.map((point) => point.join(',')).join(' '), fill: paint.accent });
}

function drawDot(paint: Paint, at: Point): void {
  drawShape(paint, 'circle', { cx: at[0], cy: at[1], r: 3.5, fill: paint.accent });
}

/** Copy markup: **x** is bold, `x` is code. */
function markup(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function placeNotes(body: HTMLElement, notes: Note[]): HTMLElement[] {
  const labels: Record<string, HTMLElement> = {};
  const placed = notes.map((note) => {
    const label = document.createElement('div');
    label.className = 'note';
    const title = document.createElement('b');
    title.innerHTML = markup(note.title);
    label.append(title);
    // " / " breaks a line.
    for (const line of note.body ? note.body.split(' / ') : []) {
      const sub = document.createElement('span');
      sub.innerHTML = markup(line);
      label.append(sub);
    }
    body.append(label);
    if (note.id) labels[note.id] = label;
    return label;
  });
  // Labels hug their copy; a group shares the widest width.
  const widths: Record<string, number> = {};
  placed.forEach((label, index) => {
    const group = notes[index]?.group;
    if (group) widths[group] = Math.max(widths[group] ?? 0, Math.ceil(label.getBoundingClientRect().width));
  });
  placed.forEach((label, index) => {
    const note = notes[index];
    if (note) positionNote(label, note, note.group ? widths[note.group] : undefined, labels);
  });
  return placed;
}

function positionNote(
  label: HTMLElement,
  note: Note,
  groupWidth: number | undefined,
  labels: Record<string, HTMLElement>,
): void {
  if (groupWidth !== undefined) label.style.width = `${groupWidth}px`;
  const { width, height } = label.getBoundingClientRect();
  let left = note.at[0];
  if (note.align === 'center') left -= width / 2;
  if (note.align === 'right') left -= width;
  if (note.within) left = Math.max(note.within[0] + 12, Math.min(left, note.within[1] - 12 - width));
  let top = note.middle ? note.at[1] - height / 2 : note.at[1];
  const above = note.below ? labels[note.below[0]] : undefined;
  if (note.below && above) top = above.getBoundingClientRect().bottom + note.below[1];
  label.style.left = `${Math.round(left)}px`;
  label.style.top = `${Math.round(top)}px`;
}

/**
 * Arrows from a label to rings drawn by other notes. A route leaves the
 * label's top or left edge, follows its elbows, and ends on the ring's edge:
 * level if the last elbow is level with the ring, else aimed at its centre.
 */
function drawRoutes(paint: Paint, routes: Route[], label: HTMLElement): void {
  const rect = label.getBoundingClientRect();
  for (const route of routes) {
    const { cx, cy, r } = route.ring;
    const via = route.via ?? [];
    const start = routeStart(paint, rect, route, via);
    const last = via.at(-1) ?? start;
    const dy = last[1] - cy;
    let end: Point;
    if (via.length > 0 && Math.abs(dy) < r) {
      end = [cx - Math.sign(cx - last[0]) * Math.sqrt(r * r - dy * dy), last[1]];
    } else {
      const length = Math.hypot(cx - last[0], cy - last[1]) || 1;
      end = [cx - ((cx - last[0]) / length) * r, cy - ((cy - last[1]) / length) * r];
    }
    const tip = 3;
    const length = Math.hypot(end[0] - last[0], end[1] - last[1]) || 1;
    const tipEnd: Point = [end[0] - ((end[0] - last[0]) / length) * tip, end[1] - ((end[1] - last[1]) / length) * tip];
    const points = [start, ...via, tipEnd];
    drawShape(paint, 'polyline', { points: points.map((point) => point.join(',')).join(' '), fill: 'none', stroke: paint.accent, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    drawDot(paint, start);
    drawArrowhead(paint, last, end);
  }
}

/**
 * An offset pins the start: px from the label's left on the top edge, or
 * from its top on the right edge.
 */
function routeStart(paint: Paint, rect: DOMRect, route: Route, via: Point[]): Point {
  const { corner } = paint;
  const { cx, cy } = route.ring;
  if (route.offset !== undefined) {
    if (route.from === 'right') return [rect.right, rect.top + route.offset];
    if (route.from === 'top') return [rect.left + route.offset, rect.top];
  }
  if (route.from === 'left') {
    return [rect.left, Math.max(rect.top + corner, Math.min(via[0]?.[1] ?? cy, rect.bottom - corner))];
  }
  return [cx < rect.left + corner ? rect.left + corner : Math.min(cx, rect.right - corner), rect.top];
}

function drawTarget(paint: Paint, note: Note, t: Box, label: HTMLElement): void {
  if (note.inside) {
    drawShape(paint, 'rect', { x: t.x, y: t.y, width: t.w, height: t.h, rx: 8, fill: 'none', stroke: paint.accent, 'stroke-width': 2.5 });
    return;
  }
  const rect = label.getBoundingClientRect();
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const anchor = edgeAnchor(paint, rect, cx, cy);
  const start = note.shape === 'ring'
    ? ringStart(paint, note, t, anchor)
    : rectStart(paint, note, t, anchor);
  drawShape(paint, 'line', { x1: start[0], y1: start[1], x2: anchor[0], y2: anchor[1], stroke: paint.accent, 'stroke-width': 2, 'stroke-linecap': 'round' });
  drawDot(paint, anchor);
  // Arrowhead on the target end, pointing at the target.
  if (note.arrow) drawArrowhead(paint, anchor, start);
  if (note.target2) drawSourceBox(paint, note.target2, rect);
}

function ringStart(paint: Paint, note: Note, t: Box, anchor: Point): Point {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const dx = anchor[0] - cx;
  const dy = anchor[1] - cy;
  const length = Math.hypot(dx, dy) || 1;
  const r = note.ring ?? Math.max(t.w, t.h) / 2 + 6;
  drawShape(paint, 'circle', { cx, cy, r, fill: 'none', stroke: paint.accent, 'stroke-width': 2.5 });
  return [cx + (dx / length) * r, cy + (dy / length) * r];
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
  drawShape(paint, 'rect', { x: cx - hw, y: cy - hh, width: hw * 2, height: hh * 2, rx: 8, fill: 'none', stroke: paint.accent, 'stroke-width': 2.5 });
  // Enter through the left edge, level with the label where possible.
  if (note.enter === 'left') return [cx - hw, Math.max(cy - hh + 10, Math.min(ay, cy + hh - 10))];
  // Leave through the top edge, toward the label's side.
  if (note.exit === 'top') return [Math.max(cx - hw + 10, Math.min(ax, cx + hw - 10)), cy - hh];
  const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return [cx + dx * k, cy + dy * k];
}

/** A second leader from the label to the matching source lines. */
function drawSourceBox(paint: Paint, target: Box, rect: DOMRect): void {
  const pad = 3;
  // Stop a source box short of a label to its right.
  const gap = 14;
  const u = target.x < rect.left
    ? { ...target, w: Math.min(target.w, rect.left - gap - pad - target.x) }
    : target;
  drawShape(paint, 'rect', { x: u.x - pad, y: u.y - pad, width: u.w + pad * 2, height: u.h + pad * 2, rx: 6, fill: 'none', stroke: paint.accent, 'stroke-width': 2.5 });
  // The second target may sit on either side of the label.
  const onLeft = u.x + u.w < rect.left;
  const ex = onLeft ? u.x + u.w + pad : u.x - pad;
  const ey = Math.max(u.y, Math.min(rect.top + rect.height / 2, u.y + u.h));
  const bx = onLeft ? rect.left : rect.right;
  const by = Math.max(rect.top + paint.corner, Math.min(ey, rect.bottom - paint.corner));
  drawShape(paint, 'line', { x1: bx, y1: by, x2: ex, y2: ey, stroke: paint.accent, 'stroke-width': 2, 'stroke-linecap': 'round' });
  drawDot(paint, [bx, by]);
}

function drawTags(body: HTMLElement, tags: Tag[]): void {
  for (const item of tags) {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = item.text;
    tag.style.left = `${item.x}px`;
    tag.style.top = `${item.y}px`;
    if (item.size) tag.style.fontSize = `${item.size}px`;
    if (item.center) tag.style.transform = 'translateX(-50%)';
    if (item.right) tag.style.transform = 'translateX(-100%)';
    body.append(tag);
  }
}

/** Page script for compose(): every declaration above, then the entry point. */
export const canvasScript = [
  drawLayers,
  drawMasks,
  drawShape,
  edgeAnchor,
  drawArrowhead,
  drawDot,
  markup,
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
