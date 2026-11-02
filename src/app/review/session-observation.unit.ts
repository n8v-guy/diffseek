import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import { emptyFacetExclusions, type FileRecord } from '@diffseek/review';

import {
  pageNodesChanged,
  projectionKeyFor,
  queuePanelReconcile,
  scheduleForMutations,
  type PanelReconcileSchedule,
} from './session-observation';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const metadata = { codeowners: '', attributes: '' };
const filterDefaults: FilterDefaults = { hidden: new Set(), viewed: new Set() };

function file(): FileRecord {
  return {
    path: 'src/app.ts',
    anchor: 'diff-src/app.ts',
    extension: '.ts',
    owners: [],
    generated: false,
    status: 'modified',
    viewed: false,
    capabilities: { collapse: true, viewed: true },
    labels: [],
  };
}

function key(record: FileRecord): string {
  return projectionKeyFor({
    metadataRevision: 0,
    metadata,
    filters: emptyFacetExclusions(),
    filterDefaults,
    generatedDefaultBusy: false,
    menuCount: 0,
    files: [record],
  });
}

describe('projection key', () => {
  it('changes when a file field changes', () => {
    const original = key(file());
    const extension = file();
    extension.extension = null;
    const anchor = file();
    anchor.anchor = 'diff-other';
    const linguist = file();
    linguist.labels = [{ facet: 'languages', value: 'TypeScript', fromLinguistLanguage: true }];
    const plain = file();
    plain.labels = [{ facet: 'languages', value: 'TypeScript' }];
    expect(key(extension)).not.toBe(original);
    expect(key(anchor)).not.toBe(original);
    expect(key(linguist)).not.toBe(key(plain));
  });
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
