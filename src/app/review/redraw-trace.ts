export interface RedrawCounts {
  domMutations: number;
  panelNetLoss: number;
  panelRebuilds: number;
  panelsReadded: number;
  panelsRemoved: number;
  reconciles: number;
  treeNetLoss: number;
  treeRebuilds: number;
  treeRowsReadded: number;
  treeRowsRemoved: number;
}

const rebuildRows = 8;
const massRemoval = 48;
const readdWindowMs = 100;
/** Hot loads ignore the mass-removal rule and require each removed row back inside this window. */
const hotSettleMs = 500;
const treeSelector = '[role="treeitem"]';
const panelSelector = '[role="region"][id^="diff-"]';

interface SettleLedger {
  netLoss: number;
  open: Map<string, number>;
  readded: number;
}

type Trace = RedrawCounts & {
  depth: number;
  observer: MutationObserver;
  panelSettle: SettleLedger;
  pendingPanels: Map<string, number>;
  pendingTree: Map<string, number>;
  treeSettle: SettleLedger;
};

const redrawCountKeys = [
  'domMutations',
  'panelNetLoss',
  'panelRebuilds',
  'panelsReadded',
  'panelsRemoved',
  'reconciles',
  'treeNetLoss',
  'treeRebuilds',
  'treeRowsReadded',
  'treeRowsRemoved',
] as const satisfies readonly (keyof RedrawCounts)[];

function countsFrom(trace?: RedrawCounts): RedrawCounts {
  const counts = zeroRedrawCounts();
  if (trace === undefined) return counts;
  for (const key of redrawCountKeys) counts[key] = trace[key];
  return counts;
}

function emptyLedger(): SettleLedger {
  return { netLoss: 0, open: new Map(), readded: 0 };
}

function zeroRedrawCounts(): RedrawCounts {
  return {
    domMutations: 0,
    panelNetLoss: 0,
    panelRebuilds: 0,
    panelsReadded: 0,
    panelsRemoved: 0,
    reconciles: 0,
    treeNetLoss: 0,
    treeRebuilds: 0,
    treeRowsReadded: 0,
    treeRowsRemoved: 0,
  };
}

const traces = new WeakMap<Document, Trace>();

interface RowNotes {
  kind: 'panel' | 'tree';
  pending: Map<string, number>;
  selector: string;
}

export function installRedrawTrace(root: Document): void {
  if (traces.has(root)) return;
  const trace: Trace = {
    ...countsFrom(),
    depth: 0,
    observer: new MutationObserver(() => undefined),
    panelSettle: emptyLedger(),
    pendingPanels: new Map(),
    pendingTree: new Map(),
    treeSettle: emptyLedger(),
  };
  trace.observer = new MutationObserver((records) => {
    if (absorb(trace, records)) publish(root, trace);
  });
  observeStructure(trace, root);
  root.addEventListener('diffseek-redraw-reset', () => {
    resetRedrawTrace(root);
  });
  root.addEventListener('diffseek-redraw-settle', () => {
    const current = traces.get(root);
    if (!current) return;
    settleTrace(current, Date.now());
    publish(root, current);
  });
  traces.set(root, trace);
  publish(root, trace);
}

export function noteReconcile(root: Document): void {
  const trace = traces.get(root);
  if (trace) {
    trace.reconciles += 1;
    publish(root, trace);
  }
  const epoch = root.documentElement.dataset.diffseekFirstRenderEpoch;
  if (
    (epoch === undefined || epoch === '') &&
    root.querySelector('[data-diffseek-viewed-action]')
  ) {
    root.documentElement.dataset.diffseekFirstRenderEpoch = String(Date.now());
  }
}

export function readRedrawCounts(root: Document): RedrawCounts {
  const trace = traces.get(root);
  if (trace) {
    settleTrace(trace, Date.now());
    publish(root, trace);
  }
  return countsFrom(trace);
}

export function resetRedrawTrace(root: Document): void {
  const trace = traces.get(root);
  if (!trace) return;
  Object.assign(trace, countsFrom());
  trace.pendingTree.clear();
  trace.pendingPanels.clear();
  trace.treeSettle = emptyLedger();
  trace.panelSettle = emptyLedger();
  publish(root, trace);
}

export function trackDiffseekWrites<T>(root: Document, run: () => T): T {
  const trace = traces.get(root);
  if (!trace) return run();
  // Keep the childList observer in place. Re-arming attributes on the whole
  // document made the filter-menu fill wait on a full-page attribute walk.
  trace.depth += 1;
  try {
    return run();
  } finally {
    queueMicrotask(() => {
      trace.depth = Math.max(0, trace.depth - 1);
    });
  }
}

function absorb(trace: Trace, records: MutationRecord[]): boolean {
  const before = mutationStamp(trace);
  if (trace.depth > 0) trace.domMutations += countMutations(records);
  noteRows(trace, records, {
    kind: 'tree',
    pending: trace.pendingTree,
    selector: treeSelector,
  });
  noteRows(trace, records, {
    kind: 'panel',
    pending: trace.pendingPanels,
    selector: panelSelector,
  });
  return mutationStamp(trace) !== before;
}

function closeLedger(ledger: SettleLedger, now: number): void {
  for (const [id, at] of ledger.open) {
    if (now - at < hotSettleMs) continue;
    ledger.open.delete(id);
    ledger.netLoss += 1;
  }
}

function collectChangedIds(
  records: MutationRecord[],
  selector: string,
  removed: Set<string>,
  added: Set<string>,
): void {
  for (const record of records) {
    if (record.type !== 'childList') continue;
    for (const node of record.addedNodes) collectIds(node, selector, added);
    for (const node of record.removedNodes) collectIds(node, selector, removed);
  }
}

function collectIds(node: Node, selector: string, into: Set<string>): void {
  if (!(node instanceof Element)) return;
  // The filter menu is not a file tree. Walking it on every open showed up as
  // longer long tasks and cannot be a tree or diff-panel rebuild.
  const role = node.getAttribute('role');
  if (role === 'menu' || role === 'menuitem' || role === 'menuitemcheckbox') return;
  const rows = [
    ...(node.matches(selector) ? [node] : []),
    ...node.querySelectorAll<HTMLElement>(selector),
  ];
  for (const row of rows) into.add(row.id);
}

function countMutations(records: MutationRecord[]): number {
  let count = 0;
  for (const record of records) {
    if (targetsDocumentElement(record.target)) continue;
    count +=
      record.type === 'childList'
        ? record.addedNodes.length + record.removedNodes.length
        : 1;
  }
  return count;
}

function countRebuilt(
  removed: Set<string>,
  added: Set<string>,
  pending: Map<string, number>,
  now: number,
): number {
  let rebuilt = 0;
  for (const id of removed) {
    if (added.has(id)) rebuilt += 1;
    else pending.set(id, now);
  }
  for (const id of added) {
    const at = pending.get(id);
    if (at === undefined || now - at > readdWindowMs) continue;
    pending.delete(id);
    rebuilt += 1;
  }
  for (const [id, at] of pending) {
    if (now - at > readdWindowMs) pending.delete(id);
  }
  return rebuilt;
}

function mutationStamp(trace: Trace): string {
  return [
    trace.domMutations,
    trace.treeRebuilds,
    trace.panelRebuilds,
    trace.treeRowsRemoved,
    trace.panelsRemoved,
    trace.treeRowsReadded,
    trace.panelsReadded,
    trace.treeNetLoss,
    trace.panelNetLoss,
    trace.treeSettle.open.size,
    trace.panelSettle.open.size,
  ].join(':');
}

function noteReturns(
  ledger: SettleLedger,
  removed: Set<string>,
  added: Set<string>,
  now: number,
): void {
  for (const id of removed) {
    if (!id) continue;
    if (added.has(id)) {
      ledger.readded += 1;
      ledger.open.delete(id);
      continue;
    }
    if (!ledger.open.has(id)) ledger.open.set(id, now);
  }
  for (const id of added) {
    if (!id || removed.has(id)) continue;
    const at = ledger.open.get(id);
    if (at === undefined) continue;
    ledger.open.delete(id);
    if (now - at <= hotSettleMs) ledger.readded += 1;
    else ledger.netLoss += 1;
  }
}

function noteRows(trace: Trace, records: MutationRecord[], notes: RowNotes): void {
  const now = Date.now();
  const removed = new Set<string>();
  const added = new Set<string>();
  collectChangedIds(records, notes.selector, removed, added);
  const rebuilt = countRebuilt(removed, added, notes.pending, now);
  const ledger = notes.kind === 'tree' ? trace.treeSettle : trace.panelSettle;
  noteReturns(ledger, removed, added, now);
  recordRowCounts(trace, {
    kind: notes.kind,
    ledger,
    rebuilt,
    removed: removed.size,
  });
}

function observeStructure(trace: Trace, root: Document): void {
  trace.observer.observe(root.documentElement, {
    childList: true,
    subtree: true,
  });
}

function publish(root: Document, trace: Trace): void {
  const data = root.documentElement.dataset;
  writeCount(data, 'diffseekReconciles', trace.reconciles);
  writeCount(data, 'diffseekDomMutations', trace.domMutations);
  writeCount(data, 'diffseekTreeRebuilds', trace.treeRebuilds);
  writeCount(data, 'diffseekPanelRebuilds', trace.panelRebuilds);
  writeCount(data, 'diffseekTreeRowsRemoved', trace.treeRowsRemoved);
  writeCount(data, 'diffseekPanelsRemoved', trace.panelsRemoved);
  writeCount(data, 'diffseekTreeRowsReadded', trace.treeRowsReadded);
  writeCount(data, 'diffseekPanelsReadded', trace.panelsReadded);
  writeCount(data, 'diffseekTreeNetLoss', trace.treeNetLoss);
  writeCount(data, 'diffseekPanelNetLoss', trace.panelNetLoss);
  // Rows removed and not yet back: lets the hot check wait for an event
  // (every row returned) instead of a fixed settle delay.
  writeCount(data, 'diffseekTreeOpen', trace.treeSettle.open.size);
  writeCount(data, 'diffseekPanelOpen', trace.panelSettle.open.size);
}

function recordRowCounts(
  trace: Trace,
  counts: {
    kind: 'panel' | 'tree';
    ledger: SettleLedger;
    rebuilt: number;
    removed: number;
  },
): void {
  const rebuiltNow =
    counts.rebuilt >= rebuildRows || counts.removed >= massRemoval;
  if (counts.kind === 'tree') {
    trace.treeRowsRemoved += counts.removed;
    trace.treeRowsReadded = counts.ledger.readded;
    trace.treeNetLoss = counts.ledger.netLoss;
    if (rebuiltNow) trace.treeRebuilds += 1;
    return;
  }
  trace.panelsRemoved += counts.removed;
  trace.panelsReadded = counts.ledger.readded;
  trace.panelNetLoss = counts.ledger.netLoss;
  if (rebuiltNow) trace.panelRebuilds += 1;
}

function settleTrace(trace: Trace, now: number): void {
  closeLedger(trace.treeSettle, now);
  closeLedger(trace.panelSettle, now);
  trace.treeRowsReadded = trace.treeSettle.readded;
  trace.panelsReadded = trace.panelSettle.readded;
  trace.treeNetLoss = trace.treeSettle.netLoss;
  trace.panelNetLoss = trace.panelSettle.netLoss;
}

function targetsDocumentElement(target: Node): boolean {
  const root: Node | null = target.ownerDocument?.documentElement ?? null;
  return target === root;
}

function writeCount(data: DOMStringMap, key: string, value: number): void {
  const next = String(value);
  if (data[key] !== next) data[key] = next;
}
