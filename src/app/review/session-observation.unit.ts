import { afterEach, describe, expect, it } from 'vitest';

import {
  pageNodesChanged,
  queuePanelReconcile,
  type PanelReconcileSchedule,
} from './session-observation';

afterEach(() => {
  document.body.replaceChildren();
});

describe('panel reconcile scheduling', () => {
  it('runs a coalesced burst once at the next frame and an immediate flush first', async () => {
    document.body.innerHTML =
      '<ul role="menu" aria-label="Filter options"></ul>';
    const state: PanelReconcileSchedule = { cancel: null, immediate: false };
    let runs = 0;
    const run = () => {
      runs += 1;
    };
    queuePanelReconcile(state, document, { coalesce: true }, run);
    queuePanelReconcile(state, document, { coalesce: true }, run);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(runs).toBe(1);

    queuePanelReconcile(state, document, { coalesce: true }, run);
    queuePanelReconcile(state, document, { immediate: true }, run);
    queuePanelReconcile(state, document, { coalesce: true }, run);
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve(null);
      };
      channel.port2.postMessage(null);
    });
    expect(runs).toBe(2);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(runs).toBe(2);
  });

  it('detects a replaced file tree or diff region node', () => {
    const tree = document.createElement('ul');
    const region = document.createElement('div');
    expect(pageNodesChanged(null, tree, [], [region])).toBe(true);
    expect(pageNodesChanged(tree, tree, [region], [region])).toBe(false);
    expect(pageNodesChanged(tree, tree, [region], [document.createElement('div')])).toBe(
      true,
    );
  });
});
