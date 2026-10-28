export type RedrawCounts = {
  reconciles: number;
  domMutations: number;
  treeRebuilds: number;
  panelRebuilds: number;
  treeRowsRemoved: number;
  panelsRemoved: number;
};

const rebuildRows = 8;
const massRemoval = 48;
const readdWindowMs = 100;
const treeSelector = '[role="treeitem"]';
const panelSelector = '[role="region"][id^="diff-"]';

type Trace = RedrawCounts & {
  depth: number;
  pendingTree: Map<string, number>;
  pendingPanels: Map<string, number>;
  observer: MutationObserver;
};

const traces = new WeakMap<Document, Trace>();

export function installRedrawTrace(root: Document): void {
  if (traces.has(root)) return;
  const trace: Trace = {
    reconciles: 0,
    domMutations: 0,
    treeRebuilds: 0,
    panelRebuilds: 0,
    treeRowsRemoved: 0,
    panelsRemoved: 0,
    depth: 0,
    pendingTree: new Map(),
    pendingPanels: new Map(),
    observer: new MutationObserver(() => undefined),
  };
  trace.observer = new MutationObserver((records) => {
    if (absorb(trace, records)) publish(root, trace);
  });
  observeStructure(trace, root);
  root.addEventListener('diffseek-redraw-reset', () => {
    resetRedrawTrace(root);
  });
  traces.set(root, trace);
  publish(root, trace);
}

export function resetRedrawTrace(root: Document): void {
  const trace = traces.get(root);
  if (!trace) return;
  trace.reconciles = 0;
  trace.domMutations = 0;
  trace.treeRebuilds = 0;
  trace.panelRebuilds = 0;
  trace.treeRowsRemoved = 0;
  trace.panelsRemoved = 0;
  trace.pendingTree.clear();
  trace.pendingPanels.clear();
  publish(root, trace);
}

export function noteReconcile(root: Document): void {
  const trace = traces.get(root);
  if (trace) {
    trace.reconciles += 1;
    publish(root, trace);
  }
  const data = root.documentElement.dataset;
  if (
    !data.diffseekFirstRenderEpoch &&
    root.querySelector('[data-diffseek-viewed-action]')
  ) {
    data.diffseekFirstRenderEpoch = String(Date.now());
  }
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

export function readRedrawCounts(root: Document): RedrawCounts {
  const trace = traces.get(root);
  return {
    reconciles: trace?.reconciles ?? 0,
    domMutations: trace?.domMutations ?? 0,
    treeRebuilds: trace?.treeRebuilds ?? 0,
    panelRebuilds: trace?.panelRebuilds ?? 0,
    treeRowsRemoved: trace?.treeRowsRemoved ?? 0,
    panelsRemoved: trace?.panelsRemoved ?? 0,
  };
}

function absorb(trace: Trace, records: MutationRecord[]): boolean {
  const before = mutationStamp(trace);
  if (trace.depth > 0) trace.domMutations += countMutations(records);
  noteRows(trace, records, treeSelector, trace.pendingTree, 'tree');
  noteRows(trace, records, panelSelector, trace.pendingPanels, 'panel');
  return mutationStamp(trace) !== before;
}

function noteRows(
  trace: Trace,
  records: MutationRecord[],
  selector: string,
  pending: Map<string, number>,
  kind: 'tree' | 'panel',
): void {
  const now = Date.now();
  const removed = new Set<string>();
  const added = new Set<string>();
  for (const record of records) {
    if (record.type !== 'childList') continue;
    for (const node of record.addedNodes) collectIds(node, selector, added);
    for (const node of record.removedNodes) collectIds(node, selector, removed);
  }
  const rebuilt = countRebuilt(removed, added, pending, now);
  if (kind === 'tree') {
    trace.treeRowsRemoved += removed.size;
    if (rebuilt >= rebuildRows || removed.size >= massRemoval) {
      trace.treeRebuilds += 1;
    }
    return;
  }
  trace.panelsRemoved += removed.size;
  if (rebuilt >= rebuildRows || removed.size >= massRemoval) {
    trace.panelRebuilds += 1;
  }
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
    if (at == null || now - at > readdWindowMs) continue;
    pending.delete(id);
    rebuilt += 1;
  }
  for (const [id, at] of pending) {
    if (now - at > readdWindowMs) pending.delete(id);
  }
  return rebuilt;
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
    const root = record.target.ownerDocument?.documentElement;
    if (record.target === root) continue;
    count +=
      record.type === 'childList'
        ? record.addedNodes.length + record.removedNodes.length
        : 1;
  }
  return count;
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
}

function writeCount(data: DOMStringMap, key: string, value: number): void {
  const next = String(value);
  if (data[key] !== next) data[key] = next;
}

function mutationStamp(trace: Trace): string {
  return [
    trace.domMutations,
    trace.treeRebuilds,
    trace.panelRebuilds,
    trace.treeRowsRemoved,
    trace.panelsRemoved,
  ].join(':');
}
