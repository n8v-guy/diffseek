import { afterEach, describe, expect, it } from 'vitest';

import {
  installRedrawTrace,
  noteReconcile,
  readRedrawCounts,
  resetRedrawTrace,
  trackDiffseekWrites,
} from './redraw-trace';

afterEach(() => {
  document.body.replaceChildren();
  resetRedrawTrace(document);
});

describe('redraw trace', () => {
  it('counts diffseek writes, reconcile passes, and a tree rebuild', async () => {
    installRedrawTrace(document);
    const tree = document.createElement('ul');
    tree.setAttribute('role', 'tree');
    document.body.append(tree);
    await flush();

    trackDiffseekWrites(document, () => {
      const row = document.createElement('li');
      row.id = 'src/app.ts';
      row.setAttribute('role', 'treeitem');
      tree.append(row);
      row.classList.add('diffseek-viewed-icon-anchor');
    });
    noteReconcile(document);
    await flush();

    expect(readRedrawCounts(document).reconciles).toBe(1);
    expect(readRedrawCounts(document).domMutations).toBeGreaterThan(0);
    expect(readRedrawCounts(document).treeRebuilds).toBe(0);

    const rows = Array.from({ length: 8 }, (_item, index) => {
      const row = document.createElement('li');
      row.id = `src/file-${index}.ts`;
      row.setAttribute('role', 'treeitem');
      tree.append(row);
      return row;
    });
    await flush();
    for (const row of rows) row.remove();
    await flush();
    for (const row of rows) tree.append(row);
    await flush();

    expect(readRedrawCounts(document).treeRebuilds).toBe(1);
    expect(readRedrawCounts(document).treeRowsRemoved).toBe(8);

    document.dispatchEvent(new Event('diffseek-redraw-reset'));
    expect(readRedrawCounts(document).reconciles).toBe(0);
    expect(readRedrawCounts(document).treeRebuilds).toBe(0);
  });

  it('treats rows restored within 500ms as churn and rows that stay gone as a loss', async () => {
    installRedrawTrace(document);
    const tree = document.createElement('ul');
    tree.setAttribute('role', 'tree');
    document.body.append(tree);
    const control = document.createElement('span');
    control.dataset.diffseekViewedAction = 'true';
    tree.append(control);
    const rows = Array.from({ length: 10 }, (_item, index) => {
      const row = document.createElement('li');
      row.id = `src/kept-${index}.ts`;
      row.setAttribute('role', 'treeitem');
      tree.append(row);
      return row;
    });
    await flush();
    resetRedrawTrace(document);

    for (const row of rows) row.remove();
    await flush();
    for (const row of rows) tree.append(row);
    await flush();
    const restored = readRedrawCounts(document);
    expect(restored.treeRowsRemoved).toBe(10);
    expect(restored.treeRowsReadded).toBe(10);
    expect(restored.treeNetLoss).toBe(0);
    expect(restored.treeRebuilds).toBe(1);

    resetRedrawTrace(document);
    for (const row of rows) row.remove();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 520));
    document.dispatchEvent(new Event('diffseek-redraw-settle'));
    const discarded = readRedrawCounts(document);
    expect(discarded.treeRowsRemoved).toBe(10);
    expect(discarded.treeRowsReadded).toBe(0);
    expect(discarded.treeNetLoss).toBe(10);
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
