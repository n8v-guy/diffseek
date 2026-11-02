import type { FilterDefaultState, RememberedFilterFacet } from '@diffseek/browser/filter-defaults';
import type { FileRecord, FilterState, LabelFacet } from '@diffseek/review';

import { describe, expect, it, vi } from 'vitest';

import { mountFilterMenu } from './filter-menu';
import {
  changeHandler,
  files,
  filters,
  menu,
  menuExcludingGroup,
  viewedHandler,
  withSecondOwner,
} from './filter-menu.fixture';

function countText(element: ParentNode, selector: string): null | string | undefined {
  return element.querySelector(selector)?.textContent;
}

describe('mountFilterMenu counts', () => {
  it('shows visible and total counters for every category', () => {
    const element = menu();
    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(
      countText(
        element,
        '.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="Tests"]) .diffseek-menu-count',
      ),
    ).toContain('1/1');
    expect(
      countText(
        element,
        '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count',
      ),
    ).toContain('1/1');
  });

  it('updates visible counts when files are filtered out', () => {
    const element = menuExcludingGroup('Tests');

    expect(
      countText(
        element,
        '.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="Tests"]) .diffseek-menu-count',
      ),
    ).toContain('0/1');
    expect(
      countText(
        element,
        '.diffseek-menu-row:has([data-filter-kind="statuses"][data-filter-value="modified"]) .diffseek-menu-count',
      ),
    ).toContain('1/2');
  });
});

describe('mountFilterMenu owner prefixes', () => {
  it('removes a shared owner prefix from two or more mapped owners', () => {
    const element = menu();
    mountFilterMenu(element, {
      files: withSecondOwner('@team/platform'),
      filters: filters(),
      onChange: changeHandler(),
    });

    const owners = [
      ...element.querySelectorAll<HTMLElement>('[data-filter-kind="owners"]'),
    ];
    expect(owners.map((owner) => owner.dataset['filterValue'])).toStrictEqual([
      '@team/backend',
      '@team/platform',
      'Unmapped',
    ]);
    expect(owners.map((owner) => owner.textContent)).toStrictEqual([
      expect.stringContaining('backend'),
      expect.stringContaining('platform'),
      expect.stringContaining('No owner'),
    ]);
    expect(owners.map((owner) => owner.textContent).join(' ')).not.toContain(
      '@team/',
    );
  });

  it('keeps owner prefixes when fewer than two owners share one', () => {
    const element = menu();
    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(element.textContent).toContain('@docs');
    expect(element.textContent).toContain('@owner');
  });

  it('keeps owner prefixes when mapped owners belong to different organizations', () => {
    const element = menu();
    mountFilterMenu(element, {
      files: withSecondOwner('@other/platform'),
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(element.textContent).toContain('@team/backend');
    expect(element.textContent).toContain('@other/platform');
  });
});

function autoViewRow(element: ParentNode): {
  alwaysRead: HTMLButtonElement;
  generated: Element;
} {
  const generated = element.querySelector(
    '[data-filter-kind="generated"][data-filter-value="true"]',
  );
  const alwaysRead = element.querySelector<HTMLButtonElement>(
    '[data-diffseek-always-read]',
  );
  if (!generated || !alwaysRead) throw new Error('Missing auto-view row');
  return { alwaysRead, generated };
}

function generatedFile(): FileRecord {
  const source = files[1];
  if (!source) throw new Error('Missing generated fixture');
  return {
    ...source,
    capabilities: { collapse: true, viewed: true },
    labels: source.labels.filter((label) => label.facet !== 'viewed'),
    viewed: false,
  };
}

describe('generated default busy row', () => {
  it('disables the generated row while default mark-viewed is busy', () => {
    const element = menu();
    const state = filters();
    const onChange = changeHandler();
    const onFilterDefaultChange =
      vi.fn<(facet: RememberedFilterFacet, state: FilterDefaultState) => void>();
    const onViewed = viewedHandler();
    const filterDefaults = {
      hidden: new Set<RememberedFilterFacet>(['generated']),
      viewed: new Set<'generated'>(['generated']),
    };

    mountFilterMenu(element, {
      files: [generatedFile()],
      filterDefaults,
      filters: state,
      generatedDefaultBusy: true,
      onChange,
      onFilterDefaultChange,
      onViewed,
    });

    const generated = element.querySelector<HTMLButtonElement>(
      '[data-filter-kind="generated"][data-filter-value="true"]',
    );
    const viewedAction = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"]',
    );
    expect(generated?.disabled).toBe(true);
    expect(generated?.getAttribute('aria-busy')).toBe('true');
    expect(viewedAction?.disabled).toBe(true);
    generated?.click();
    viewedAction?.click();
    element.querySelector<HTMLButtonElement>('[data-diffseek-always-read]')?.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(onFilterDefaultChange).not.toHaveBeenCalled();
    expect(onViewed).not.toHaveBeenCalled();
    expect(filterDefaults.viewed.has('generated')).toBe(true);
  });
});

describe('generated auto-view', () => {
  it('toggles auto-view without cycling the generated filter', () => {
    const element = menu();
    const state = filters();
    const filterDefaults = {
      hidden: new Set<RememberedFilterFacet>(['generated']),
      viewed: new Set<'generated'>(),
    };
    const onChange = changeHandler();
    const onFilterDefaultChange =
      vi.fn<(facet: RememberedFilterFacet, state: FilterDefaultState) => void>();
    const onAlwaysReadChange = vi.fn<(enabled: boolean) => void>();
    mountFilterMenu(element, {
      files,
      filterDefaults,
      filters: state,
      onAlwaysReadChange,
      onChange,
      onFilterDefaultChange,
    });

    const { alwaysRead, generated } = autoViewRow(element);
    expect(alwaysRead.textContent).toBe('auto-view');
    expect(alwaysRead.title).toBe('Always mark generated files viewed');
    expect(alwaysRead.className).toBe('diffseek-menu-always-read');
    expect(alwaysRead.getAttribute('aria-pressed')).toBe('false');
    expect(generated.getAttribute('aria-checked')).toBe('mixed');

    alwaysRead.click();
    expect(alwaysRead.getAttribute('aria-pressed')).toBe('true');
    expect(filterDefaults.viewed).toStrictEqual(new Set(['generated']));
    expect(generated.getAttribute('aria-checked')).toBe('mixed');
    expect(onAlwaysReadChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(onFilterDefaultChange).not.toHaveBeenCalled();

    alwaysRead.click();
    expect(alwaysRead.getAttribute('aria-pressed')).toBe('false');
    expect(filterDefaults.viewed).toStrictEqual(new Set());
    expect(onAlwaysReadChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

function addValue(state: FilterState, facet: LabelFacet, value: string): void {
  const values = state.get(facet);
  if (!values) throw new Error(`Missing ${facet}`);
  values.add(value);
}

function rememberedDefaults(): {
  hidden: Set<RememberedFilterFacet>;
  viewed: Set<'generated'>;
} {
  return {
    hidden: new Set<RememberedFilterFacet>(['generated', 'viewed']),
    viewed: new Set<'generated'>(['generated']),
  };
}

function requireReset(element: ParentNode): HTMLButtonElement {
  const reset = element.querySelector<HTMLButtonElement>('[data-reset-filters]');
  if (!reset) throw new Error('Missing reset');
  return reset;
}

describe('mountFilterMenu reset', () => {
  it('does not show reset for exclusions backed only by defaults', () => {
    const element = menu();
    const state = filters();
    const filterDefaults = rememberedDefaults();
    state.get('viewed')?.add('true');
    state.get('generated')?.add('true');

    mountFilterMenu(element, {
      files,
      filterDefaults,
      filters: state,
      onChange: changeHandler(),
    });

    expect(element.querySelector('[data-reset-filters]')).toBeNull();
  });

  it('resets transient exclusions without changing defaults', () => {
    const element = menu();
    const state = filters();
    const filterDefaults = rememberedDefaults();
    const onChange = changeHandler();
    const onFilterDefaultChange =
      vi.fn<(facet: RememberedFilterFacet, state: FilterDefaultState) => void>();
    addValue(state, 'groups', 'Tests');
    addValue(state, 'viewed', 'true');
    addValue(state, 'generated', 'true');

    mountFilterMenu(element, {
      files,
      filterDefaults,
      filters: state,
      onChange,
      onFilterDefaultChange,
    });

    const reset = requireReset(element);
    expect(reset.textContent).toBe('');
    expect(reset.querySelector('svg[data-diffseek-reset-icon]')).not.toBeNull();
    expect(reset.querySelector('svg[data-diffseek-reset-icon] path')).not.toBeNull();
    expect(reset.getAttribute('aria-label')).toBe('Reset filters');
    expect(
      reset.closest('[data-diffseek="filters"]')?.querySelectorAll(
        '[data-diffseek-separator]',
      ),
    ).toHaveLength(4);
    reset.click();
    expect(state.get('groups')).toStrictEqual(new Set());
    expect(state.get('viewed')).toStrictEqual(new Set(['true']));
    expect(state.get('generated')).toStrictEqual(new Set(['true']));
    expect(filterDefaults).toStrictEqual({
      hidden: new Set(['generated', 'viewed']),
      viewed: new Set(['generated']),
    });
    expect(onFilterDefaultChange).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledExactlyOnceWith();

    mountFilterMenu(element, {
      files,
      filterDefaults,
      filters: state,
      onChange,
      onFilterDefaultChange,
    });
    expect(element.querySelector('[data-reset-filters]')).toBeNull();
  });
});

const markAll = 'Mark all viewed';
const modifiedCount =
  '[data-diffseek-menu-count-action][data-viewed-facet="statuses"][data-viewed-value="modified"]';
const modifiedAction =
  '[data-diffseek-menu-viewed-action][data-viewed-facet="statuses"][data-viewed-value="modified"]';

function hideViewed(state: FilterState): void {
  const viewed = state.get('viewed');
  if (!viewed) throw new Error('Missing viewed facet');
  viewed.add('true');
}

function ownerActions(element: ParentNode): {
  action: HTMLButtonElement;
  counter: HTMLButtonElement;
} {
  const row = element.querySelector(
    '.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@owner"])',
  );
  const action = row?.querySelector<HTMLButtonElement>(
    '[data-diffseek-menu-viewed-action]',
  );
  const counter = row?.querySelector<HTMLButtonElement>(
    '[data-diffseek-menu-count-action]',
  );
  if (!action || !counter) throw new Error('Missing owner actions');
  return { action, counter };
}

function retargetOwner(file: FileRecord): FileRecord {
  if (file.path !== 'docs/guide.md') return file;
  return {
    ...file,
    labels: file.labels.map((label) =>
      label.facet === 'owners' ? { ...label, value: '@owner' } : label,
    ),
  };
}

describe('mountFilterMenu viewed actions', () => {
  it('marks only the currently visible files for a label', () => {
    const element = menu();
    const state = filters();
    const onChange = changeHandler();
    const onViewed = viewedHandler();
    state.get('groups')?.add('Tests');

    mountFilterMenu(element, { files, filters: state, onChange, onViewed });

    const action = element.querySelector<HTMLButtonElement>(modifiedAction);
    const counter = element.querySelector<HTMLButtonElement>(modifiedCount);
    expect(action?.title).toBe(markAll);
    expect(counter?.title).toBe(markAll);
    expect(action?.getAttribute('aria-pressed')).toBe('false');
    const tests = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Tests"]',
    );
    expect(tests?.title).toBe(markAll);
    counter?.click();
    expect(onViewed).toHaveBeenCalledWith(true, ['src/app.test.ts', 'unmapped.txt']);
    onViewed.mockClear();
    action?.click();
    expect(onViewed).toHaveBeenCalledWith(true, ['src/app.test.ts', 'unmapped.txt']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers to mark a fully viewed visible label as not viewed', () => {
    const element = menu();
    const onViewed = viewedHandler();

    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: changeHandler(),
      onViewed,
    });

    const action = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"][data-viewed-value="true"]',
    );
    const counter = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-count-action][data-viewed-facet="generated"][data-viewed-value="true"]',
    );
    expect(action?.title).toBe('Unmark all');
    expect(counter?.title).toBe('Unmark all');
    counter?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
    onViewed.mockClear();
    action?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
  });

  it('marks visible unread files when some counted files are hidden as viewed', () => {
    const element = menu();
    const state = filters();
    const onViewed = viewedHandler();
    hideViewed(state);

    mountFilterMenu(element, {
      files: files.map((file) => retargetOwner(file)),
      filters: state,
      onChange: changeHandler(),
      onViewed,
    });

    const { action, counter } = ownerActions(element);
    expect(counter.textContent).toBe('1/2');
    expect(action.title).toBe('Mark the rest viewed');
    expect(counter.title).toBe('Mark the rest viewed');
    expect(action.getAttribute('aria-pressed')).toBe('mixed');
    expect(action.classList.contains('diffseek-viewed-partial')).toBe(true);
    expect(counter.classList.contains('diffseek-viewed-partial')).toBe(false);
    expect(counter.getAttribute('aria-pressed')).toBe('mixed');
    counter.click();
    expect(onViewed).toHaveBeenCalledWith(true, ['src/app.test.ts']);
    onViewed.mockClear();
    action.click();
    expect(onViewed).toHaveBeenCalledWith(true, ['src/app.test.ts']);
  });
});
