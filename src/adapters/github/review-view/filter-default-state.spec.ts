import { describe, expect, it, vi } from 'vitest';

import {
  applyCheckedState,
  cycleFilterDefault,
  type FilterDefaultOptions,
} from './filter-default-state';

describe('filter default state', () => {
  it('keeps viewed files on a three-state cycle', () => {
    const { item, options } = setup('viewed');

    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('false');
    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('mixed');
    expect(options.filterDefaults?.hidden).toEqual(new Set(['viewed']));
    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(options.filterDefaults?.hidden).toEqual(new Set());
  });

  it('adds default viewed to the generated four-state cycle', () => {
    const { item, options, onFilterDefaultChange } = setup('generated');

    cycle(item, options);
    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('mixed');
    expect(item.dataset.defaultViewed).toBeUndefined();
    cycle(item, options);
    expect(item.dataset.defaultViewed).toBe('true');
    expect(options.filterDefaults?.viewed).toEqual(new Set(['generated']));
    expect(onFilterDefaultChange).toHaveBeenLastCalledWith(
      'generated',
      'hidden-viewed',
    );
    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(item.dataset.defaultViewed).toBeUndefined();
  });
});

function setup(facet: 'viewed' | 'generated') {
  const item = document.createElement('button');
  const onFilterDefaultChange = vi.fn();
  const options: FilterDefaultOptions = {
    facet,
    value: 'true',
    excluded: new Set(),
    filterDefaults: {
      hidden: new Set(),
      viewed: new Set(),
    },
    onFilterDefaultChange,
  };
  applyCheckedState(item, options);
  return { item, onFilterDefaultChange, options };
}

function cycle(
  item: HTMLButtonElement,
  options: FilterDefaultOptions,
): void {
  cycleFilterDefault(options);
  applyCheckedState(item, options);
}
