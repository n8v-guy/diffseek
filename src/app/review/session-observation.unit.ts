import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pageNodesChanged,
  queuePanelReconcile,
  scheduleForMutations,
  type PanelReconcileSchedule,
} from './session-observation';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('panel reconcile scheduling', () => {
  it('coalesces streamed diff panels and ignores diff-body noise', async () => {
    const region = document.createElement('div');
    region.id = 'diff-app';
    region.setAttribute('role', 'region');
    const records = await captureMutations(() => {
      document.body.append(region);
    });
    expect(scheduleForMutations(records)).toEqual({ coalesce: true });

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
    expect(scheduleForMutations(viewed)).toEqual({ immediate: true });

    const menu = await captureMutations(() => {
      const element = document.createElement('ul');
      element.setAttribute('role', 'menu');
      element.setAttribute('aria-label', 'Filter options');
      document.body.append(element);
    });
    expect(scheduleForMutations(menu)).toEqual({ immediate: true });

    const shell = document.createElement('div');
    const unlabelled = document.createElement('ul');
    unlabelled.setAttribute('role', 'menu');
    shell.append(unlabelled);
    const revealed = await captureMutations(() => {
      document.body.append(shell);
      unlabelled.setAttribute('aria-label', 'Filter options');
    });
    expect(scheduleForMutations(revealed)).toEqual({ immediate: true });

    const trigger = document.createElement('button');
    trigger.setAttribute('aria-label', 'Filter options');
    document.body.append(trigger);
    const opened = await captureMutations(() => {
      trigger.classList.add('open');
    });
    expect(scheduleForMutations(opened)).toEqual({ immediate: true });
  });

  it('keeps a coalesced flush on a 64ms timer while the filter menu is open', async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<ul role="menu" aria-label="Filter options"></ul>';
    const state: PanelReconcileSchedule = {
      timer: null,
      delayMs: 0,
      scheduled: false,
    };
    let runs = 0;
    queuePanelReconcile(state, document, { coalesce: true }, () => {
      runs += 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(63);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(1);
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
    attributes: true,
    attributeFilter: ['aria-label', 'aria-pressed', 'aria-labelledby', 'class'],
    childList: true,
    subtree: true,
  });
  mutate();
  await Promise.resolve();
  observer.disconnect();
  return records;
}
