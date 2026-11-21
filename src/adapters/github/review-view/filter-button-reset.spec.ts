import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyFacetExclusions } from '@diffseek/review';

import {
  ensureFilterButtonReset,
  filteredAttribute,
  syncFilteredAttribute,
} from './filter-button-reset';

const pill = () => document.querySelector<HTMLButtonElement>('[data-diffseek="filter-button-reset"]');

function present<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Missing ${label}`);
  return value;
}

const visibilityCss = `
  [data-diffseek='filter-button-reset'] { display: none; }
  html[data-diffseek-filtered] button[aria-expanded='false'] + [data-diffseek='filter-button-reset'],
  html[data-diffseek-filtered] button:not([aria-expanded]) + [data-diffseek='filter-button-reset'] {
    display: flex;
  }
`;

function narrowed() {
  const filters = emptyFacetExclusions();
  filters.get('groups')?.add('Docs');
  return filters;
}

function mount(filters = narrowed()) {
  syncFilteredAttribute(document, filters);
  return ensureFilterButtonReset(document, { filters, onChange: vi.fn() });
}

describe('ensureFilterButtonReset', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(filteredAttribute);
    document.head.innerHTML = '';
    // GitHub's captured markup: the static copy, then the interactive one Primer anchors.
    document.body.innerHTML = `<div id="filter-wrap">
      <span id="static-label">Filter options</span>
      <button aria-haspopup="true" aria-expanded="false" aria-labelledby="static-label"></button>
      <span id="live-label">Filter options</span>
      <button aria-haspopup="true" aria-expanded="false" aria-labelledby="live-label"
        style="anchor-name: --filter-anchor;"></button>
    </div>`;
    const style = document.createElement('style');
    style.textContent = visibilityCss;
    document.head.append(style);
  });

  it('inserts one icon beside the hydrated filter button', () => {
    expect(mount()).toBe(true);
    expect(mount()).toBe(false);

    const live = document.querySelector('[aria-labelledby="live-label"]');
    expect(pill()?.getAttribute('aria-label')).toBe('Reset filters');
    expect(pill()?.querySelector('span')).toBeNull();
    expect(pill()?.querySelector('svg')).not.toBeNull();
    expect(pill()?.getAttribute('style')).toBeNull();
    expect(pill()?.previousElementSibling).toBe(live);
    expect(pill()?.parentElement?.id).toBe('filter-wrap');
  });

  it('mounts beside the static trigger, then moves once when the live one is anchored', () => {
    const live = present(
      document.querySelector<HTMLButtonElement>('[aria-labelledby="live-label"]'),
      'live filter button',
    );
    live.removeAttribute('style');
    const staticButton = document.querySelector('[aria-labelledby="static-label"]');
    expect(mount()).toBe(true);
    expect(pill()?.previousElementSibling).toBe(staticButton);

    live.setAttribute('style', 'anchor-name: --filter-anchor;');
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      true,
    );
    expect(pill()?.previousElementSibling).toBe(live);
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      false,
    );
    expect(pill()?.getAttribute('style')).toBeNull();
  });

  it('does not write when only the trigger anchor name changes', () => {
    const live = present(
      document.querySelector<HTMLButtonElement>('[aria-labelledby="live-label"]'),
      'live filter button',
    );
    mount();
    const icon = present(pill(), 'reset icon');
    live.setAttribute('style', 'anchor-name: --filter-anchor-2;');
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      false,
    );
    expect(icon.getAttribute('style')).toBeNull();
    expect(icon.previousElementSibling).toBe(live);
  });

  it('shows the pill through the page attribute, and hides it while the menu is open', () => {
    const live = document.querySelector('[aria-labelledby="live-label"]');
    mount();
    expect(document.documentElement.getAttribute(filteredAttribute)).toBe('true');
    expect(getComputedStyle(present(pill(), "reset pill")).display).toBe('flex');

    live?.setAttribute('aria-expanded', 'true');
    expect(pill()?.previousElementSibling).toBe(live);
    expect(getComputedStyle(present(pill(), "reset pill")).display).toBe('none');

    syncFilteredAttribute(document, emptyFacetExclusions());
    live?.setAttribute('aria-expanded', 'false');
    expect(document.documentElement.hasAttribute(filteredAttribute)).toBe(false);
    expect(pill()).not.toBeNull();
    expect(getComputedStyle(present(pill(), "reset pill")).display).toBe('none');
  });

  it('resets review filters, keeps hidden defaults, and asks for a pass', () => {
    const filters = narrowed();
    const onChange = vi.fn();
    const filterDefaults = { hidden: new Set(['viewed'] as const), viewed: new Set<'generated'>() };
    filters.get('viewed')?.add('true');
    syncFilteredAttribute(document, filters, filterDefaults);
    ensureFilterButtonReset(document, { filters, filterDefaults, onChange });

    pill()?.click();

    expect(filters.get('groups')?.size).toBe(0);
    expect(filters.get('viewed')).toEqual(new Set(['true']));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('survives a button swap in the same wrapper and re-inserts if the wrapper is replaced', () => {
    const wrap = document.getElementById('filter-wrap');
    const live = present(
      document.querySelector('[aria-labelledby="live-label"]'),
      'live filter button',
    );
    mount();
    const first = pill();

    const swapped = live.cloneNode(true) as HTMLButtonElement;
    swapped.setAttribute('style', 'anchor-name: --filter-anchor-2;');
    live.replaceWith(swapped);
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      false,
    );
    expect(pill()).toBe(first);
    expect(pill()?.previousElementSibling).toBe(swapped);

    const added = swapped.cloneNode(true) as HTMLButtonElement;
    added.setAttribute('style', 'anchor-name: --filter-anchor-3;');
    swapped.remove();
    wrap?.append(added);
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      true,
    );
    expect(pill()).toBe(first);
    expect(pill()?.previousElementSibling).toBe(added);
    expect(pill()?.parentElement).toBe(wrap);

    const replacement = document.createElement('div');
    replacement.id = 'filter-wrap';
    replacement.innerHTML = `<span id="live-label">Filter options</span>
      <button aria-haspopup="true" aria-expanded="false" aria-labelledby="live-label"
        style="anchor-name: --filter-anchor;"></button>`;
    wrap?.replaceWith(replacement);
    expect(pill()).toBeNull();
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      true,
    );
    const nextLive = replacement.querySelector('button');
    expect(pill()?.previousElementSibling).toBe(nextLive);
    expect(pill()?.parentElement).toBe(replacement);
  });

  it('keeps the owned pill through a trigger gap and replaces a cloned pill', () => {
    const wrap = present(document.getElementById('filter-wrap'), 'filter wrapper');
    mount();
    const first = present(pill(), 'reset pill');

    for (const button of [...wrap.querySelectorAll('button[aria-haspopup]')]) {
      button.remove();
    }
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      false,
    );
    expect(pill()).toBe(first);
    expect(getComputedStyle(first).display).toBe('none');

    const hydrated = document.createElement('button');
    hydrated.setAttribute('aria-haspopup', 'true');
    hydrated.setAttribute('aria-expanded', 'false');
    hydrated.setAttribute('aria-labelledby', 'live-label');
    hydrated.setAttribute('style', 'anchor-name: --filter-anchor-live;');
    wrap.append(hydrated);
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      true,
    );
    expect(pill()).toBe(first);
    expect(pill()?.previousElementSibling).toBe(hydrated);
    expect(getComputedStyle(first).display).toBe('flex');

    const cloneWrap = wrap.cloneNode(true) as HTMLElement;
    wrap.replaceWith(cloneWrap);
    const clone = pill();
    expect(clone).not.toBeNull();
    const onChange = vi.fn();
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange })).toBe(true);
    expect(pill()).not.toBe(clone);
    pill()?.click();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('does not move the pill when only aria-expanded changes', () => {
    const live = document.querySelector('[aria-labelledby="live-label"]');
    mount();
    const first = pill();
    live?.setAttribute('aria-expanded', 'true');
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      false,
    );
    expect(pill()).toBe(first);
    live?.setAttribute('aria-expanded', 'false');
    expect(ensureFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(
      false,
    );
    expect(pill()).toBe(first);
  });

  it('does not let a wrapper click handler run when the pill is clicked', () => {
    const onWrapper = vi.fn();
    document.getElementById('filter-wrap')?.addEventListener('click', onWrapper);
    const filters = narrowed();
    const onChange = vi.fn();
    syncFilteredAttribute(document, filters);
    ensureFilterButtonReset(document, { filters, onChange });

    pill()?.click();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onWrapper).not.toHaveBeenCalled();
    expect(filters.get('groups')?.size).toBe(0);
  });
});
