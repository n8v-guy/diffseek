import { describe, expect, it, vi } from 'vitest';

import {
  itemOnlyAction,
  sectionAllAction,
} from './filter-shortcuts';

describe('filter shortcuts', () => {
  it('keeps only one value without changing another facet', () => {
    const excluded = new Set<string>();
    const otherFacet = new Set(['Tests']);
    const onChange = vi.fn<() => void>();
    const action = itemOnlyAction({
      excluded,
      label: 'Owner',
      onChange,
      value: '@owner',
      values: ['@docs', '@owner', 'Unmapped'],
    });

    action.click();

    expect(excluded).toStrictEqual(new Set(['@docs', 'Unmapped']));
    expect(otherFacet).toStrictEqual(new Set(['Tests']));
    expect(onChange).toHaveBeenCalledExactlyOnceWith();
  });

  it('restores every value in one section', () => {
    const excluded = new Set(['@docs', 'Unmapped']);
    const onChange = vi.fn<() => void>();
    const action = sectionAllAction({
      excluded,
      heading: 'Owners',
      onChange,
    });

    action.click();

    expect(excluded).toStrictEqual(new Set());
    expect(onChange).toHaveBeenCalledExactlyOnceWith();
  });
});
