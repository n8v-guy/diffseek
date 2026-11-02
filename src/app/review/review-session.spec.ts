import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';

import { startReviewApp } from './review-app';
import { appendMarkup, inertMetadata, replaceBody } from './review-app.fixture';

describe('review session stream batching', () => {
  beforeEach((): void => {
    fakeBrowser.reset();
    replaceBody(fixture);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('updates a viewed toggle immediately and coalesces panel bursts', async () => {
    const app = await startReviewApp({
      pathname: (): string => '/octo/repo/pull/1/changes',
      ...inertMetadata,
      root: document,
    });
    let reconciles = 0;
    document.addEventListener('diffseek-reconciled', (): void => {
      reconciles += 1;
    });

    const viewed = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Not Viewed"]',
    );
    viewed?.setAttribute('aria-label', 'Viewed');
    viewed?.setAttribute('aria-pressed', 'true');
    await Promise.resolve();
    expect(reconciles).toBe(0);
    await nextTask();
    expect(reconciles).toBe(1);
    expect(
      document
        .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Unmark');

    // A burst inside one task costs one pass, at the next frame.
    await appendStreamRegions(0, 5);
    expect(reconciles).toBe(1);
    await nextFrame();
    expect(reconciles).toBe(2);

    await appendStreamRegions(5, 8);
    expect(reconciles).toBe(2);
    await nextFrame();
    expect(reconciles).toBe(3);

    app.stop();
  });
});

describe('redraw budget', () => {
  beforeEach((): void => {
    fakeBrowser.reset();
    replaceBody(pageHtml(80));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('keeps streamed diff lines from redrawing the review', async () => {
    const counts = watchCounts();
    const app = await startReviewApp({
      pathname: (): string => '/octo/repo/pull/1/changes',
      ...inertMetadata,
      root: document,
    });
    await flush();
    const loaded = counts.snapshot();

    counts.ignore(true);
    appendMarkup(
      '<ul role="menu" aria-label="Filter options"><li role="menuitem">Native</li></ul>',
    );
    counts.ignore(false);
    await nextTask();
    const menu = counts.snapshot();

    const host = document.getElementById('diff-host');
    const frames = countFrames();
    for (let index = 0; index < 80; index += 1) {
      counts.ignore(true);
      host?.append(regionNode(index));
      counts.ignore(false);
      await nextTask();
      for (let noise = 0; noise < 3; noise += 1) {
        counts.ignore(true);
        const line = document.createElement('span');
        line.className = 'blob-code';
        line.textContent = `line ${noise}`;
        host?.lastElementChild?.append(line);
        line.classList.add('highlighted');
        counts.ignore(false);
        await nextTask();
      }
    }
    await nextFrame();
    const streamed = counts.snapshot();
    const streamFrames = frames.stop();

    document
      .querySelector<HTMLButtonElement>('[data-filter-kind="viewed"]')
      ?.click();
    await flush();
    const toggled = counts.snapshot();

    const viewed = document.querySelector<HTMLButtonElement>(
      '#diff-file-0 button[aria-label="Not Viewed"]',
    );
    counts.ignore(true);
    viewed?.setAttribute('aria-label', 'Viewed');
    viewed?.setAttribute('aria-pressed', 'true');
    counts.ignore(false);
    await nextTask();
    const marked = counts.snapshot();

    const report = {
      load: loaded,
      mark: diff(toggled, marked),
      menu: diff(loaded, menu),
      stream: diff(menu, streamed),
      toggle: diff(streamed, toggled),
      total: marked,
    };
    expect(report.load.reconciles).toBe(1);
    expect(report.menu.reconciles).toBe(1);
    // At most one pass per frame the stream spanned; diff lines add none.
    expect(report.stream.reconciles).toBeLessThanOrEqual(streamFrames);
    expect(report.stream.domMutations).toBeLessThanOrEqual(500);
    expect(report.toggle.reconciles).toBe(1);
    expect(report.mark.reconciles).toBe(1);
    expect(report.total.reconciles).toBeLessThanOrEqual(streamFrames + 4);
    expect(report.total.domMutations).toBeLessThanOrEqual(550);
    expect(report.total.treeRebuilds).toBe(0);
    expect(report.total.panelRebuilds).toBe(0);
    expect(report.total.treeRowsRemoved).toBe(0);
    expect(report.total.panelsRemoved).toBe(0);
    app.stop();
  }, 30_000);
});

interface Counts {
  domMutations: number;
  panelRebuilds: number;
  panelsRemoved: number;
  reconciles: number;
  treeRebuilds: number;
  treeRowsRemoved: number;
}

async function appendStreamRegions(start: number, end: number): Promise<void> {
  for (let index = start; index < end; index += 1) {
    const region = document.createElement('div');
    region.id = `diff-stream-${index}`;
    region.setAttribute('role', 'region');
    document.body.append(region);
    await Promise.resolve();
  }
}

function collectRows(
  node: Node,
  kind: 'panel' | 'tree',
  into: Map<string, number> | Set<string>,
): number {
  if (!(node instanceof Element)) return 0;
  const selector =
    kind === 'tree'
      ? '[role="treeitem"]'
      : '[role="region"][id^="diff-"]';
  const rows = [
    ...(node.matches(selector) ? [node] : []),
    ...node.querySelectorAll(selector),
  ];
  for (const row of rows) {
    if (into instanceof Map) into.set(row.id, Date.now());
    else into.add(row.id);
  }
  return rows.length;
}

function countFrames(): { stop: () => number } {
  let frames = 0;
  let live = true;
  const tick = (): void => {
    if (!live) return;
    frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: (): number => {
      live = false;
      return frames;
    },
  };
}

function diff(before: Counts, after: Counts): Counts {
  return {
    domMutations: after.domMutations - before.domMutations,
    panelRebuilds: after.panelRebuilds - before.panelRebuilds,
    panelsRemoved: after.panelsRemoved - before.panelsRemoved,
    reconciles: after.reconciles - before.reconciles,
    treeRebuilds: after.treeRebuilds - before.treeRebuilds,
    treeRowsRemoved: after.treeRowsRemoved - before.treeRowsRemoved,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const anchorAttributes = new Set(['aria-label', 'aria-pressed', 'title']);
const diffseekSelector = '[data-diffseek], .diffseek-viewed-icon-anchor, [data-diffseek-viewed-action]';
const injectedSelector = '[data-diffseek], .diffseek-viewed-icon-anchor';

function absorbRecords(
  records: MutationRecord[],
  counts: Counts,
  pendingTree: Map<string, number>,
  pendingPanels: Map<string, number>,
): void {
  const now = Date.now();
  let removedTree = 0;
  let removedPanels = 0;
  const addedTree = new Set<string>();
  const addedPanels = new Set<string>();
  for (const record of records) {
    if (isDiffseekMutation(record)) counts.domMutations += mutationSize(record);
    if (record.type !== 'childList') continue;
    for (const node of record.addedNodes) {
      collectRows(node, 'tree', addedTree);
      collectRows(node, 'panel', addedPanels);
    }
    for (const node of record.removedNodes) {
      removedTree += collectRows(node, 'tree', pendingTree);
      removedPanels += collectRows(node, 'panel', pendingPanels);
    }
  }
  const rebuiltTree = takeRebuilt(pendingTree, addedTree, now);
  const rebuiltPanels = takeRebuilt(pendingPanels, addedPanels, now);
  counts.treeRowsRemoved += removedTree;
  counts.panelsRemoved += removedPanels;
  if (rebuiltTree >= 8 || removedTree >= 48) counts.treeRebuilds += 1;
  if (rebuiltPanels >= 8 || removedPanels >= 48) counts.panelRebuilds += 1;
}

function diffseekNode(node: Node): boolean {
  return node instanceof Element && (
    node.matches(injectedSelector) || node.querySelector(injectedSelector) !== null
  );
}

function isDiffseekAttribute(target: Element, name: string): boolean {
  if (name === 'hidden' && target.getAttribute('role') === 'treeitem') return true;
  if (name.startsWith('data-diffseek')) return true;
  if (!target.classList.contains('diffseek-viewed-icon-anchor')) return false;
  return name === 'class' || anchorAttributes.has(name);
}

function isDiffseekMutation(record: MutationRecord): boolean {
  if (!(record.target instanceof Element) || record.target === document.documentElement) {
    return false;
  }
  if (record.target.closest(diffseekSelector) !== null) return true;
  if (record.type === 'attributes' && isDiffseekAttribute(record.target, record.attributeName ?? '')) {
    return true;
  }
  return [...record.addedNodes, ...record.removedNodes].some((node) => diffseekNode(node));
}

function mutationSize(record: MutationRecord): number {
  return record.type === 'childList'
    ? record.addedNodes.length + record.removedNodes.length
    : 1;
}

async function nextFrame(): Promise<void> {
  await flush();
  await new Promise<void>((resolve): void => {
    requestAnimationFrame((): void => { resolve(); });
  });
}

/** Lets observer callbacks queue their pass, then runs the next task. */
async function nextTask(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', (): void => {
      channel.port1.close();
      resolve();
    }, { once: true });
    channel.port1.start();
    channel.port2.postMessage(null);
  });
}

function pageHtml(count: number): string {
  const rows = Array.from({ length: count }, (_item, index) => {
    const path = `src/file-${index}.ts`;
    return `<li id="${path}" role="treeitem" aria-label="file-${index}.ts"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-diff"></svg></div><a href="#diff-file-${index}">${path}</a></li>`;
  }).join('');
  return `<body><button aria-label="Filter options"></button><ul role="tree" aria-label="File Tree">${rows}</ul><div id="diff-host"></div></body>`;
}

function regionNode(index: number): HTMLElement {
  const region = document.createElement('div');
  region.id = `diff-file-${index}`;
  region.setAttribute('role', 'region');
  const parsed = new DOMParser().parseFromString(
    `<div data-diff-header-wrapper="true"><button aria-label="Collapse file"></button><h3><code>src/file-${index}.ts</code></h3><button aria-label="Not Viewed" aria-pressed="false">Viewed</button></div>`,
    'text/html',
  );
  const header = parsed.body.firstElementChild;
  if (header !== null) region.append(document.importNode(header, true));
  return region;
}

function takeRebuilt(
  pending: Map<string, number>,
  added: Set<string>,
  now: number,
): number {
  let rebuilt = 0;
  for (const id of added) {
    const at = pending.get(id);
    if (at === undefined || now - at > 100) continue;
    pending.delete(id);
    rebuilt += 1;
  }
  for (const [id, at] of pending) {
    if (now - at > 100) pending.delete(id);
  }
  return rebuilt;
}

function watchCounts(): {
  ignore: (value: boolean) => void;
  snapshot: () => Counts;
} {
  const counts: Counts = {
    domMutations: 0,
    panelRebuilds: 0,
    panelsRemoved: 0,
    reconciles: 0,
    treeRebuilds: 0,
    treeRowsRemoved: 0,
  };
  let ignoring = false;
  document.addEventListener('diffseek-reconciled', (): void => {
    if (!ignoring) counts.reconciles += 1;
  });
  const pendingTree = new Map<string, number>();
  const pendingPanels = new Map<string, number>();
  const observer = new MutationObserver((records): void => {
    if (ignoring) return;
    absorbRecords(records, counts, pendingTree, pendingPanels);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  return {
    ignore(value: boolean): void {
      ignoring = value;
    },
    snapshot: (): Counts => ({ ...counts }),
  };
}
