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
    document.body.innerHTML =
      '<button aria-label="Filter options" aria-expanded="false" style="anchor-name: --filter-anchor"></button>';
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

    syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() });
    document.querySelector('button')?.setAttribute('aria-expanded', 'true');
    syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() });
    expect(pill()).toBeNull();

    document.querySelector('button')?.removeAttribute('style');
    document.querySelector('button')?.setAttribute('aria-expanded', 'false');
    syncFilterButtonReset(document, { filters: narrowed(), onChange: vi.fn() });
    expect(pill()).toBeNull();
  });
});
