import { describe, expect, it, vi } from 'vitest';

import {
  itemOnlyAction,
  sectionAllAction,
} from './filter-shortcuts';

describe('filter shortcuts', () => {
  it('keeps only one value without changing another facet', () => {
    const excluded = new Set<string>();
    const otherFacet = new Set(['Tests']);
    const onChange = vi.fn();
    const action = itemOnlyAction({
      excluded,
      label: 'Owner',
      onChange,
      value: '@owner',
      values: ['@docs', '@owner', 'Unmapped'],
    });

    action.click();

    expect(excluded).toEqual(new Set(['@docs', 'Unmapped']));
    expect(otherFacet).toEqual(new Set(['Tests']));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('restores every value in one section', () => {
    const excluded = new Set(['@docs', 'Unmapped']);
    const onChange = vi.fn();
    const action = sectionAllAction({
      excluded,
      heading: 'Owners',
      onChange,
    });

    action.click();

    expect(excluded).toEqual(new Set());
    expect(onChange).toHaveBeenCalledOnce();
  });
});
