import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyFacetExclusions } from '@diffseek/review';

import { syncFilterButtonReset } from './filter-button-reset';

const pill = () => document.querySelector<HTMLButtonElement>('[data-diffseek="filter-button-reset"]');

function narrowed() {
  const filters = emptyFacetExclusions();
  filters.get('groups')?.add('Docs');
  return filters;
}

describe('syncFilterButtonReset', () => {
  beforeEach(() => {
    // GitHub's captured markup: the static copy, then the interactive one Primer anchors.
    document.body.innerHTML = `<span id="static-label">Filter options</span>
      <button aria-haspopup="true" aria-expanded="false" aria-labelledby="static-label"></button>
      <span id="live-label">Filter options</span>
      <button aria-haspopup="true" aria-expanded="false" aria-labelledby="live-label"
        style="anchor-name: --filter-anchor;"></button>`;
  });

  it('tethers a labeled pill to the filter button while review filters hide files', () => {
    syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() });

    expect(pill()?.textContent).toBe('Reset filters');
    expect(pill()?.querySelector('span + svg')).not.toBeNull();
    expect(pill()?.getAttribute('style')).toBe('position-anchor: --filter-anchor');
  });

  it('resets review filters, keeps hidden defaults, and asks for a pass', () => {
    const filters = narrowed();
    const onChange = vi.fn();
    const filterDefaults = { hidden: new Set(['viewed'] as const), viewed: new Set<'generated'>() };
    filters.get('viewed')?.add('true');
    syncFilterButtonReset(document, { filters, filterDefaults, onChange });

    pill()?.click();

    expect(filters.get('groups')?.size).toBe(0);
    expect(filters.get('viewed')).toEqual(new Set(['true']));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('is absent with nothing to reset, while the menu is open, or with no anchor', () => {
    syncFilterButtonReset(document, { filters: emptyFacetExclusions(), onChange: vi.fn() });
    expect(pill()).toBeNull();

    const live = document.querySelector('[aria-labelledby="live-label"]');
    expect(syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(true);
    expect(syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(false);
    live?.setAttribute('aria-expanded', 'true');
    expect(syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() })).toBe(true);
    expect(pill()).toBeNull();

    live?.remove();
    syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() });
    expect(pill()).toBeNull();
  });
});
