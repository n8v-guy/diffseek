import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';

import { startReviewApp } from './review-app';

const emptyMetadata = { codeowners: '', attributes: '' };

beforeEach(() => {
  fakeBrowser.reset();
  document.documentElement.innerHTML = fixture;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('review session stream batching', () => {
  it('updates a viewed toggle immediately and coalesces panel bursts', async () => {
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => emptyMetadata,
      refreshDefault: async () => ({ metadata: emptyMetadata, changed: false }),
      readPull: async (_review, fallback) => fallback,
    });
    let reconciles = 0;
    document.addEventListener('diffseek-reconciled', () => {
      reconciles += 1;
    });

    const viewed = document.querySelector<HTMLButtonElement>(
      '#diff-app button[aria-label="Not Viewed"]',
    );
    viewed?.setAttribute('aria-label', 'Viewed');
    viewed?.setAttribute('aria-pressed', 'true');
    await Promise.resolve();
    expect(reconciles).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(reconciles).toBe(1);
    expect(
      document
        .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Mark as not viewed');

    for (let index = 0; index < 5; index += 1) {
      const region = document.createElement('div');
      region.id = `diff-stream-${index}`;
      region.setAttribute('role', 'region');
      document.body.append(region);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(reconciles).toBe(1);
    await vi.advanceTimersByTimeAsync(53);
    expect(reconciles).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconciles).toBe(2);

    for (let index = 5; index < 8; index += 1) {
      const region = document.createElement('div');
      region.id = `diff-stream-${index}`;
      region.setAttribute('role', 'region');
      document.body.append(region);
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(63);
    expect(reconciles).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconciles).toBe(3);

    app.stop();
  });
});

describe('redraw budget', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = pageHtml(80);
  });

  it('keeps streamed diff lines from redrawing the review', async () => {
    const counts = watchCounts();
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => emptyMetadata,
      refreshDefault: async () => ({ metadata: emptyMetadata, changed: false }),
      readPull: async (_review, fallback) => fallback,
    });
    await flush();
    const loaded = counts.snapshot();

    counts.ignore(true);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<ul role="menu" aria-label="Filter options"><li role="menuitem">Native</li></ul>',
    );
    counts.ignore(false);
    await settle(0);
    const menu = counts.snapshot();

    const host = document.getElementById('diff-host');
    for (let index = 0; index < 80; index += 1) {
      counts.ignore(true);
      host?.append(regionNode(index));
      counts.ignore(false);
      await settle(10);
      for (let noise = 0; noise < 3; noise += 1) {
        counts.ignore(true);
        const line = document.createElement('span');
        line.className = 'blob-code';
        line.textContent = `line ${noise}`;
        host?.lastElementChild?.append(line);
        line.classList.add('highlighted');
        counts.ignore(false);
        await settle(10);
      }
    }
    await settle(64);
    const streamed = counts.snapshot();

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
    await settle(0);
    const marked = counts.snapshot();

    const report = {
      load: loaded,
      menu: diff(loaded, menu),
      stream: diff(menu, streamed),
      toggle: diff(streamed, toggled),
      mark: diff(toggled, marked),
      total: marked,
    };
    expect(report.load.reconciles).toBe(1);
    expect(report.menu.reconciles).toBe(1);
    expect(report.stream.reconciles).toBeLessThanOrEqual(2);
    expect(report.stream.domMutations).toBeLessThanOrEqual(500);
    expect(report.toggle.reconciles).toBe(1);
    expect(report.mark.reconciles).toBe(1);
    expect(report.total.reconciles).toBeLessThanOrEqual(6);
    expect(report.total.domMutations).toBeLessThanOrEqual(550);
    expect(report.total.treeRebuilds).toBe(0);
    expect(report.total.panelRebuilds).toBe(0);
    expect(report.total.treeRowsRemoved).toBe(0);
    expect(report.total.panelsRemoved).toBe(0);
    app.stop();
  }, 30_000);
});

type Counts = {
  reconciles: number;
  domMutations: number;
  treeRowsRemoved: number;
  panelsRemoved: number;
  treeRebuilds: number;
  panelRebuilds: number;
};

function watchCounts(): {
  ignore: (value: boolean) => void;
  snapshot: () => Counts;
} {
  const counts: Counts = {
    reconciles: 0,
    domMutations: 0,
    treeRowsRemoved: 0,
    panelsRemoved: 0,
    treeRebuilds: 0,
    panelRebuilds: 0,
  };
  let ignoring = false;
  document.addEventListener('diffseek-reconciled', () => {
    if (!ignoring) counts.reconciles += 1;
  });
  const pendingTree = new Map<string, number>();
  const pendingPanels = new Map<string, number>();
  const observer = new MutationObserver((records) => {
    if (ignoring) return;
    const now = Date.now();
    let removedTree = 0;
    let removedPanels = 0;
    let rebuiltTree = 0;
    let rebuiltPanels = 0;
    const addedTree = new Set<string>();
    const addedPanels = new Set<string>();
    for (const record of records) {
      if (isDiffseekMutation(record)) {
        counts.domMutations +=
          record.type === 'childList'
            ? record.addedNodes.length + record.removedNodes.length
            : 1;
      }
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
    rebuiltTree += takeRebuilt(pendingTree, addedTree, now);
    rebuiltPanels += takeRebuilt(pendingPanels, addedPanels, now);
    counts.treeRowsRemoved += removedTree;
    counts.panelsRemoved += removedPanels;
    if (rebuiltTree >= 8 || removedTree >= 48) counts.treeRebuilds += 1;
    if (rebuiltPanels >= 8 || removedPanels >= 48) counts.panelRebuilds += 1;
  });
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  return {
    ignore(value: boolean) {
      ignoring = value;
    },
    snapshot: () => ({ ...counts }),
  };
}

function collectRows(
  node: Node,
  kind: 'tree' | 'panel',
  into: Set<string> | Map<string, number>,
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

function takeRebuilt(
  pending: Map<string, number>,
  added: Set<string>,
  now: number,
): number {
  let rebuilt = 0;
  for (const id of added) {
    const at = pending.get(id);
    if (at == null || now - at > 100) continue;
    pending.delete(id);
    rebuilt += 1;
  }
  for (const [id, at] of pending) {
    if (now - at > 100) pending.delete(id);
  }
  return rebuilt;
}

function isDiffseekMutation(record: MutationRecord): boolean {
  if (!(record.target instanceof Element)) return false;
  if (record.target === document.documentElement) return false;
  if (record.target.closest('[data-diffseek], .diffseek-viewed-icon-anchor, [data-diffseek-viewed-action]')) {
    return true;
  }
  if (record.type === 'attributes') {
    const name = record.attributeName ?? '';
    if (name === 'hidden' && record.target.getAttribute('role') === 'treeitem') {
      return true;
    }
    if (name.startsWith('data-diffseek') || name === 'class' && record.target.classList.contains('diffseek-viewed-icon-anchor')) {
      return true;
    }
    if (
      record.target.classList.contains('diffseek-viewed-icon-anchor') &&
      (name === 'aria-label' || name === 'aria-pressed' || name === 'title')
    ) {
      return true;
    }
  }
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) =>
      node instanceof Element &&
      (node.matches('[data-diffseek], .diffseek-viewed-icon-anchor') ||
        node.querySelector('[data-diffseek], .diffseek-viewed-icon-anchor') != null),
  );
}

function diff(before: Counts, after: Counts): Counts {
  return {
    reconciles: after.reconciles - before.reconciles,
    domMutations: after.domMutations - before.domMutations,
    treeRowsRemoved: after.treeRowsRemoved - before.treeRowsRemoved,
    panelsRemoved: after.panelsRemoved - before.panelsRemoved,
    treeRebuilds: after.treeRebuilds - before.treeRebuilds,
    panelRebuilds: after.panelRebuilds - before.panelRebuilds,
  };
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
  region.innerHTML = `<div data-diff-header-wrapper="true"><button aria-label="Collapse file"></button><h3><code>src/file-${index}.ts</code></h3><button aria-label="Not Viewed" aria-pressed="false">Viewed</button></div>`;
  return region;
}

async function settle(ms: number): Promise<void> {
  await flush();
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
