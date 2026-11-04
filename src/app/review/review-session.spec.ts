import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { ReviewPresenter } from '@diffseek/github';
import fixture from '@diffseek/github/review-page/fixtures/github-pr.html?raw';

import type { DefaultMetadata } from '../metadata/reader';

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
      refreshDefault: async () => ({
        metadata: emptyMetadata,
        cache: { files: {}, refreshedAt: 0, pulls: [], overlays: {} },
        changed: false,
      }),
      readPull: async (_review, base) => ({ ...base, changed: false }),
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
    await nextTask();
    expect(reconciles).toBe(1);
    expect(
      document
        .querySelector('#src\\/app\\.ts [data-diffseek-viewed-action]')
        ?.getAttribute('aria-label'),
    ).toBe('Unmark');

    // A burst inside one task costs one pass, at the next frame.
    for (let index = 0; index < 5; index += 1) {
      const region = document.createElement('div');
      region.id = `diff-stream-${index}`;
      region.setAttribute('role', 'region');
      document.body.append(region);
      await Promise.resolve();
    }
    expect(reconciles).toBe(1);
    await nextFrame();
    expect(reconciles).toBe(2);

    for (let index = 5; index < 8; index += 1) {
      const region = document.createElement('div');
      region.id = `diff-stream-${index}`;
      region.setAttribute('role', 'region');
      document.body.append(region);
      await Promise.resolve();
    }
    expect(reconciles).toBe(2);
    await nextFrame();
    expect(reconciles).toBe(3);

    app.stop();
  });
});

describe('reconcile strategy', () => {
  const attributes = (text: string) => ({ codeowners: '', attributes: text });
  const loaded = (text: string): DefaultMetadata => ({
    metadata: attributes(text),
    cache: { files: {}, refreshedAt: 0, pulls: [], overlays: {} },
    changed: false,
  });
  const cachedText = 'src/** group=Code';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function deferred<T>() {
    let resolve = (_value: T): void => undefined;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  async function startWith(options: {
    refreshDefault?: () => Promise<DefaultMetadata>;
    readPull?: (base: DefaultMetadata) => Promise<DefaultMetadata>;
  }) {
    const reconciles = { count: 0 };
    document.addEventListener('diffseek-reconciled', () => {
      reconciles.count += 1;
    });
    const apply = vi.spyOn(ReviewPresenter.prototype, 'apply');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<ul role="menu" aria-label="Filter options"></ul>',
    );
    const app = await startReviewApp({
      root: document,
      pathname: () => '/octo/repo/pull/1/changes',
      readImmediate: async () => attributes(cachedText),
      refreshDefault: options.refreshDefault ?? (async () => loaded(cachedText)),
      readPull: (_review, base) => options.readPull?.(base) ?? Promise.resolve(base),
    });
    await nextTask();
    await nextFrame();
    return { app, apply, reconciles };
  }

  it('skips a metadata change that leaves the computed view equal', async () => {
    const pull = deferred<DefaultMetadata>();
    const { app, apply, reconciles } = await startWith({
      readPull: () => pull.promise,
    });
    const passes = reconciles.count;
    const applies = apply.mock.calls.length;

    pull.resolve(loaded(`${cachedText}\n# edited in this pull request`));
    await nextTask();
    await nextFrame();

    expect(reconciles.count).toBe(passes);
    expect(apply).toHaveBeenCalledTimes(applies);
    app.stop();
  });

  it('mounts a new filter menu without applying the page again', async () => {
    const { app, apply, reconciles } = await startWith({});
    const passes = reconciles.count;
    const applies = apply.mock.calls.length;

    document.body.insertAdjacentHTML(
      'beforeend',
      '<ul role="menu" aria-label="Filter options"><li role="menuitem">Native</li></ul>',
    );
    await nextTask();

    expect(reconciles.count).toBe(passes + 1);
    expect(apply).toHaveBeenCalledTimes(applies);
    expect(document.querySelectorAll('[data-diffseek="filters"]')).toHaveLength(2);
    app.stop();
  });

  it('batches filter changes made in one task into one pass', async () => {
    const { app, reconciles } = await startWith({});
    const passes = reconciles.count;

    for (const kind of ['groups', 'statuses']) {
      document
        .querySelector<HTMLButtonElement>(`[data-filter-kind="${kind}"]`)
        ?.click();
    }
    await nextTask();

    expect(reconciles.count).toBe(passes + 1);
    app.stop();
  });

  it('batches metadata levels that arrive together into one pass', async () => {
    const defaultLevel = deferred<DefaultMetadata>();
    const { app, reconciles } = await startWith({
      refreshDefault: () => defaultLevel.promise,
      readPull: async (base) => ({
        ...base,
        metadata: attributes('src/** group=Pull'),
      }),
    });
    const passes = reconciles.count;

    defaultLevel.resolve(loaded('src/** group=Default'));
    await nextFrame();

    expect(reconciles.count).toBe(passes + 1);
    expect(document.querySelector('[data-filter-value="Pull"]')).not.toBeNull();
    expect(document.querySelector('[data-filter-value="Default"]')).toBeNull();
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
      refreshDefault: async () => ({
        metadata: emptyMetadata,
        cache: { files: {}, refreshedAt: 0, pulls: [], overlays: {} },
        changed: false,
      }),
      readPull: async (_review, base) => ({ ...base, changed: false }),
    });
    await flush();
    const loaded = counts.snapshot();

    counts.ignore(true);
    document.body.insertAdjacentHTML(
      'beforeend',
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
    await nextTask();
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
      menu: diff(loaded, menu),
      stream: diff(menu, streamed),
      toggle: diff(streamed, toggled),
      mark: diff(toggled, marked),
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

/** Lets observer callbacks queue their pass, then runs the next task. */
async function nextTask(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

async function nextFrame(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function countFrames(): { stop: () => number } {
  let frames = 0;
  let live = true;
  const tick = () => {
    if (!live) return;
    frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      live = false;
      return frames;
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
