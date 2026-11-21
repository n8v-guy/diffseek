import { afterEach, describe, expect, it } from 'vitest';

import { classifyPageMutations, watchObservationRoots } from './page-observation';

afterEach(() => {
  document.body.replaceChildren();
});

describe('GitHub page mutations', () => {
  it('coalesces streamed diff panels and ignores diff-body noise', async () => {
    const region = document.createElement('div');
    region.id = 'diff-app';
    region.setAttribute('role', 'region');
    const records = await captureMutations(() => {
      document.body.append(region);
    });
    expect(classifyPageMutations(records)).toEqual({ coalesce: true });

    const noise = await captureMutations(() => {
      const line = document.createElement('span');
      line.className = 'blob-code';
      region.append(line);
      line.classList.add('highlighted');
    });
    expect(classifyPageMutations(noise)).toBeNull();
  });

  it("flushes GitHub's swap to the anchored filter button and a streamed generated placeholder", async () => {
    document.body.innerHTML = '<span id="label">Filter options</span><div id="bar"><button aria-haspopup="true" aria-labelledby="label"></button></div>';
    const swapped = await captureMutations(() => {
      const hydrated = document.createElement('button');
      hydrated.setAttribute('aria-haspopup', 'true');
      hydrated.setAttribute('aria-labelledby', 'label');
      hydrated.setAttribute('style', 'anchor-name: --anchored-overlay-anchor-r1;');
      document.querySelector('#bar button')?.replaceWith(hydrated);
    });
    expect(classifyPageMutations(swapped)).toEqual({ immediate: true });

    const region = document.createElement('div');
    region.id = 'diff-app';
    region.setAttribute('role', 'region');
    document.body.append(region);
    const placeholder = await captureMutations(() => {
      region.insertAdjacentHTML(
        'beforeend',
        '<div><button>Load Diff</button><span>Some generated files are not rendered by default. <a href="https://docs.github.com/articles/customizing-how-changed-files-appear-on-github">docs</a></span></div>',
      );
    });
    expect(classifyPageMutations(placeholder)).toEqual({ coalesce: true });
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
    expect(classifyPageMutations(viewed)).toEqual({ immediate: true });

    const menu = await captureMutations(() => {
      const element = document.createElement('ul');
      element.setAttribute('role', 'menu');
      element.setAttribute('aria-label', 'Filter options');
      document.body.append(element);
    });
    expect(classifyPageMutations(menu)).toEqual({ immediate: true });

    const shell = document.createElement('div');
    const unlabelled = document.createElement('ul');
    unlabelled.setAttribute('role', 'menu');
    shell.append(unlabelled);
    const revealed = await captureMutations(() => {
      document.body.append(shell);
      unlabelled.setAttribute('aria-label', 'Filter options');
    });
    expect(classifyPageMutations(revealed)).toEqual({ immediate: true });

    const trigger = document.createElement('button');
    trigger.setAttribute('aria-label', 'Filter options');
    document.body.append(trigger);
    const opened = await captureMutations(() => {
      trigger.classList.add('open');
    });
    expect(classifyPageMutations(opened)).toEqual({ immediate: true });
  });

  it('flushes a gap between the filter button and Reset', async () => {
    document.body.innerHTML =
      '<div id="wrap"><button aria-label="Filter options"></button><button data-diffseek="filter-button-reset"></button></div>';
    const wrap = document.getElementById('wrap');
    const trigger = wrap?.querySelector('button');
    const split = await captureMutations(() => {
      trigger?.after(document.createElement('span'));
    });
    expect(classifyPageMutations(split)).toEqual({ immediate: true });

    const removed = await captureMutations(() => {
      wrap?.querySelector('[data-diffseek="filter-button-reset"]')?.remove();
    });
    expect(classifyPageMutations(removed)).toEqual({ immediate: true });
  });

  it('sees a late anchor-name on the live button while the static copy is first', async () => {
    document.body.innerHTML =
      '<span id="static-label">Filter options</span><button aria-haspopup="true" aria-labelledby="static-label"></button><span id="live-label">Filter options</span><button id="live" aria-haspopup="true" aria-labelledby="live-label"></button>';
    const seen: Element[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element) seen.push(record.target);
      }
    });
    const observed = new Set<Element>();
    watchObservationRoots({ root: document, observer, observedRoots: observed });
    const live = document.getElementById('live');
    live?.setAttribute('style', 'anchor-name: --anchored-overlay-anchor-r1;');
    await Promise.resolve();
    observer.disconnect();
    expect(seen).toContain(live);
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
