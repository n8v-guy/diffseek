import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pageNodesChanged,
  type PanelReconcileSchedule,
  queuePanelReconcile,
  scheduleForMutations,
} from './session-observation';

describe('panel reconcile scheduling', () => {
  afterEach((): void => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('coalesces streamed diff panels and ignores diff-body noise', async () => {
    const region = document.createElement('div');
    region.id = 'diff-app';
    region.setAttribute('role', 'region');
    const records = await captureMutations(() => {
      document.body.append(region);
    });
    expect(scheduleForMutations(records)).toStrictEqual({ coalesce: true });

    const noise = await captureMutations(() => {
      const line = document.createElement('span');
      line.className = 'blob-code';
      region.append(line);
      line.classList.add('highlighted');
    });
    expect(scheduleForMutations(noise)).toBeNull();
  });

  it('flushes viewed aria and filter-menu changes immediately', async () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Not Viewed');
    button.setAttribute('aria-pressed', 'false');
    document.body.append(button);
    const viewed = await captureMutations(() => {
      button.setAttribute('aria-label', 'Viewed');
      button.setAttribute('aria-pressed', 'true');
    });
    expect(scheduleForMutations(viewed)).toStrictEqual({ immediate: true });

    const menu = await captureMutations(() => {
      const element = document.createElement('ul');
      element.setAttribute('role', 'menu');
      element.setAttribute('aria-label', 'Filter options');
      document.body.append(element);
    });
    expect(scheduleForMutations(menu)).toStrictEqual({ immediate: true });

    const shell = document.createElement('div');
    const unlabelled = document.createElement('ul');
    unlabelled.setAttribute('role', 'menu');
    shell.append(unlabelled);
    const revealed = await captureMutations(() => {
      document.body.append(shell);
      unlabelled.setAttribute('aria-label', 'Filter options');
    });
    expect(scheduleForMutations(revealed)).toStrictEqual({ immediate: true });

    const trigger = document.createElement('button');
    trigger.setAttribute('aria-label', 'Filter options');
    document.body.append(trigger);
    const opened = await captureMutations(() => {
      trigger.classList.add('open');
    });
    expect(scheduleForMutations(opened)).toStrictEqual({ immediate: true });
  });

  it('runs a coalesced burst once at the next frame and an immediate flush first', async () => {
    const menu = document.createElement('ul');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Filter options');
    document.body.append(menu);
    const state: PanelReconcileSchedule = { cancel: null, immediate: false };
    let runs = 0;
    const run = (): void => {
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
      channel.port1.addEventListener('message', (): void => {
        channel.port1.close();
        resolve(null);
      }, { once: true });
      channel.port1.start();
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

async function captureMutations(mutate: () => void): Promise<MutationRecord[]> {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => {
    records.push(...batch);
  });
  observer.observe(document.body, {
    attributeFilter: ['aria-label', 'aria-pressed', 'aria-labelledby', 'class'],
    attributes: true,
    childList: true,
    subtree: true,
  });
  mutate();
  await Promise.resolve();
  observer.disconnect();
  return records;
}
