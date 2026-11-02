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
    expect(item.title).toBe('○ Show now\n● Hide now\n○ Always hide');
    expect(item.getAttribute('aria-label')).toBe(
      'Viewed: Hide now, click for Always hide',
    );
    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('mixed');
    expect(item.title).toBe('○ Show now\n○ Hide now\n● Always hide');
    expect(item.getAttribute('aria-label')).toBe(
      'Viewed: Always hide, click for Show now',
    );
    expect(options.filterDefaults?.hidden).toStrictEqual(new Set(['viewed']));
    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(item.title).toBe('● Show now\n○ Hide now\n○ Always hide');
    expect(item.getAttribute('aria-label')).toBe(
      'Viewed: Show now, click for Hide now',
    );
    expect(options.filterDefaults?.hidden).toStrictEqual(new Set());
  });

  it('cycles generated files through show, hide, and always hide without marking them read', () => {
    const { item, onFilterDefaultChange, options } = setup('generated');
    options.filterDefaults?.viewed.add('generated');

    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(item.title).toBe('○ Show now\n● Hide now\n○ Always hide');
    expect(item.getAttribute('aria-label')).toBe(
      'Generated: Hide now, click for Always hide',
    );
    expect(onFilterDefaultChange).not.toHaveBeenCalled();

    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('mixed');
    expect(options.filterDefaults?.hidden).toStrictEqual(new Set(['generated']));
    expect(onFilterDefaultChange).toHaveBeenLastCalledWith(
      'generated',
      'hidden',
    );

    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(options.filterDefaults?.hidden).toStrictEqual(new Set());
    expect(options.excluded.has('true')).toBe(false);
    expect(onFilterDefaultChange).toHaveBeenLastCalledWith(
      'generated',
      'shown',
    );
    expect(options.filterDefaults?.viewed).toStrictEqual(new Set(['generated']));
    expect(item.dataset['defaultViewed']).toBeUndefined();
  });

  it('shows generated files on the first click from the fresh always-hide default', () => {
    const { item, onFilterDefaultChange, options } = setup('generated');
    options.filterDefaults = {
      hidden: new Set(['generated']),
      viewed: new Set(),
    };
    options.excluded.add('true');
    applyCheckedState(item, options);

    cycle(item, options);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(options.filterDefaults.viewed).toStrictEqual(new Set());
    expect(options.filterDefaults.hidden).toStrictEqual(new Set());
    expect(onFilterDefaultChange).toHaveBeenCalledExactlyOnceWith(
      'generated',
      'shown',
    );
  });
});

function cycle(
  item: HTMLButtonElement,
  options: FilterDefaultOptions,
): void {
  cycleFilterDefault(options);
  applyCheckedState(item, options);
}

function setup(facet: 'generated' | 'viewed'): {
  item: HTMLButtonElement;
  onFilterDefaultChange: ReturnType<typeof vi.fn<(facet: 'generated' | 'viewed', state: 'hidden' | 'shown') => void>>;
  options: FilterDefaultOptions;
} {
  const item = document.createElement('button');
  const onFilterDefaultChange =
    vi.fn<(facet: 'generated' | 'viewed', state: 'hidden' | 'shown') => void>();
  const options: FilterDefaultOptions = {
    excluded: new Set(),
    facet,
    filterDefaults: {
      hidden: new Set(),
      viewed: new Set(),
    },
    onFilterDefaultChange,
    value: 'true',
  };
  applyCheckedState(item, options);
  return { item, onFilterDefaultChange, options };
}
