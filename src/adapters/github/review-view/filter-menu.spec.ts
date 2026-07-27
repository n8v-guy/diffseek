
import { describe, expect, it, vi } from 'vitest';

import { emptyFacetExclusions } from '@diffseek/review';
import type { FileRecord, FilterState } from '@diffseek/review';

import { mountFilterMenu } from './filter-menu';

const files: FileRecord[] = [
  {
    path: 'src/app.test.ts',
    anchor: 'diff-app',
    extension: '.ts',
    owners: ['@owner'],
    generated: false,
    status: 'modified',
    viewed: false,
    capabilities: { collapse: true, viewed: true },
    labels: [
      { facet: 'groups', value: 'Tests' },
      { facet: 'owners', value: '@owner' },
      { facet: 'languages', value: 'ts' },
      { facet: 'generated', value: 'false' },
      { facet: 'statuses', value: 'modified' },
    ],
  },
  {
    path: 'docs/guide.md',
    anchor: 'diff-docs',
    extension: '.md',
    owners: ['@docs'],
    generated: true,
    status: 'added',
    viewed: true,
    capabilities: { collapse: true, viewed: false },
    labels: [
      { facet: 'viewed', value: 'true' },
      { facet: 'groups', value: 'Docs' },
      { facet: 'owners', value: '@docs' },
      { facet: 'languages', value: 'md' },
      { facet: 'generated', value: 'true' },
      { facet: 'statuses', value: 'added' },
    ],
  },
  {
    path: 'unmapped.txt',
    anchor: 'diff-unmapped',
    extension: '.txt',
    owners: [],
    generated: false,
    status: 'modified',
    viewed: false,
    capabilities: { collapse: true, viewed: true },
    labels: [
      { facet: 'owners', value: 'Unmapped' },
      { facet: 'generated', value: 'false' },
      { facet: 'statuses', value: 'modified' },
    ],
  },
];

const filters = (): FilterState => emptyFacetExclusions();

function menu(): HTMLElement {
  document.body.innerHTML = `
    <ul role="menu" aria-label="Filter options">
      <li role="menuitemcheckbox" aria-label=".ts">native extension</li>
      <li role="separator">native separator</li>
    </ul>
  `;
  const element = document.querySelector<HTMLElement>('[role="menu"]');
  if (!element) throw new Error('Missing menu fixture');
  return element;
}

describe('mountFilterMenu', () => {
  it('owns the menu contents while retaining hidden native items', () => {
    const element = menu();
    const state = filters();

    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: vi.fn(),
    });
    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: vi.fn(),
    });

    expect(
      element.querySelector('[aria-label=".ts"]')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(
      element.querySelector('[role="separator"]')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(
      element.querySelectorAll('[data-diffseek-native-hidden]'),
    ).toHaveLength(2);
    expect(element.querySelectorAll('[data-diffseek="filters"]')).toHaveLength(1);
    expect(element.textContent).toContain('Types');
    expect(element.textContent).toContain('Owners');
    expect(element.textContent).toContain('Languages');
    expect(element.textContent).toContain('Viewed files');
    expect(element.textContent).toContain('Generated files');
    expect(element.textContent).toContain('Change status');
    expect(
      [...element.querySelectorAll('.diffseek-menu-section h3')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(['Owners', 'Types', 'Languages', 'Change status']);
    expect(
      element.querySelector(
        '[data-filter-kind="generated"][data-filter-value="true"]',
      )?.closest('.diffseek-menu-section'),
    ).toBeNull();
    expect(element.querySelectorAll('[data-diffseek-separator]')).toHaveLength(4);
    expect(
      [
        ...element.querySelectorAll<HTMLElement>(
          '[data-diffseek="filters"] > .diffseek-menu-content > .diffseek-menu-row [data-filter-kind]',
        ),
      ].map(({ dataset }) => dataset.filterKind),
    ).toEqual(['viewed', 'generated']);
    expect(
      [
        ...element.querySelectorAll(
          '[data-filter-kind="owners"]',
        ),
      ].map((item) => item.getAttribute('data-filter-value')),
    ).toEqual(['@docs', '@owner', 'Unmapped']);
    expect(element.textContent).toContain('No owner');
    expect(element.textContent).not.toContain('Unmapped');
    expect(element.textContent).not.toContain('matching files');
    expect(element.querySelector('[data-batch-viewed]')).toBeNull();
    expect(element.querySelector('[data-clear-filters]')).toBeNull();
  });

  it('clears an active native filter before taking over', () => {
    const element = menu();
    const clear = document.createElement('button');
    clear.textContent = 'Clear filters';
    const onClear = vi.fn();
    clear.addEventListener('click', onClear);
    element.append(clear);

    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: vi.fn(),
    });

    expect(onClear).toHaveBeenCalledOnce();
    expect(element.querySelector('[data-diffseek="filters"]')).toBeNull();
    expect(element.querySelector('[data-diffseek-native-hidden]')).toBeNull();
  });

  it('omits the generated-files choice when no generated files exist', () => {
    const element = menu();

    mountFilterMenu(element, {
      files: files.map((file) => ({
        ...file,
        generated: false,
        labels: file.labels.filter(
          (label) =>
            label.facet !== 'generated' || label.value === 'false',
        ),
      })),
      filters: filters(),
      onChange: vi.fn(),
    });

    expect(
      element.querySelector('[data-filter-kind="generated"]'),
    ).toBeNull();
    expect(element.textContent).not.toContain('Generated files');
  });

  it('starts observed values checked and unchecks an excluded value', () => {
    const element = menu();
    const state = filters();
    const onChange = vi.fn();
    mountFilterMenu(element, {
      files,
      filters: state,
      onChange,
    });

    const tests = element.querySelector<HTMLElement>(
      '[data-filter-kind="groups"][data-filter-value="Tests"]',
    );
    expect(tests?.getAttribute('aria-checked')).toBe('true');
    tests?.click();
    expect(state.get('groups')).toEqual(new Set(['Tests']));
    expect(tests?.getAttribute('aria-checked')).toBe('false');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('adds only shortcuts exclusively to multi-item sections', () => {
    const single = menu();
    mountFilterMenu(single, {
      files: [files[0]!],
      filters: filters(),
      onChange: vi.fn(),
    });
    expect(single.querySelector('[data-filter-only]')).toBeNull();

    const multiple = menu();
    mountFilterMenu(multiple, {
      files,
      filters: filters(),
      onChange: vi.fn(),
    });
    expect(multiple.querySelector('[data-filter-only]')).not.toBeNull();
  });

  it('does not show reset for exclusions backed only by defaults', () => {
    const element = menu();
    const state = filters();
    const filterDefaults = {
      hidden: new Set<'viewed' | 'generated'>(['viewed', 'generated']),
      viewed: new Set<'generated'>(['generated']),
    };
    state.get('viewed')?.add('true');
    state.get('generated')?.add('true');

    mountFilterMenu(element, {
      files,
      filters: state,
      filterDefaults,
      onChange: vi.fn(),
    });

    expect(element.querySelector('[data-reset-filters]')).toBeNull();
  });

  it('resets transient exclusions without changing defaults', () => {
    const element = menu();
    const state = filters();
    const filterDefaults = {
      hidden: new Set<'viewed' | 'generated'>(['viewed', 'generated']),
      viewed: new Set<'generated'>(['generated']),
    };
    const onChange = vi.fn();
    const onFilterDefaultChange = vi.fn();
    state.get('groups')?.add('Tests');
    state.get('viewed')?.add('true');
    state.get('generated')?.add('true');

    mountFilterMenu(element, {
      files,
      filters: state,
      filterDefaults,
      onChange,
      onFilterDefaultChange,
    });

    const reset = element.querySelector<HTMLButtonElement>(
      '[data-reset-filters]',
    );
    expect(reset?.textContent).toBe('');
    expect(
      reset?.querySelector('svg[data-diffseek-reset-icon]'),
    ).not.toBeNull();
    expect(
      reset?.querySelector('svg[data-diffseek-reset-icon] path'),
    ).not.toBeNull();
    expect(reset?.getAttribute('aria-label')).toBe('Reset filters');
    expect(
      reset?.closest('[data-diffseek="filters"]')?.querySelectorAll(
        '[data-diffseek-separator]',
      ),
    ).toHaveLength(4);
    reset?.click();
    expect(state.get('groups')).toEqual(new Set());
    expect(state.get('viewed')).toEqual(new Set(['true']));
    expect(state.get('generated')).toEqual(new Set(['true']));
    expect(filterDefaults).toEqual({
      hidden: new Set(['viewed', 'generated']),
      viewed: new Set(['generated']),
    });
    expect(onFilterDefaultChange).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledOnce();

    mountFilterMenu(element, {
      files,
      filters: state,
      filterDefaults,
      onChange,
      onFilterDefaultChange,
    });
    expect(element.querySelector('[data-reset-filters]')).toBeNull();
  });

  it('shows visible and total counters for every category', () => {
    const element = menu();
    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: vi.fn(),
    });

    expect(
      element.querySelector(
        '.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="Tests"]) .diffseek-menu-count',
      )?.textContent,
    ).toContain('1/1');
    expect(
      element.querySelector(
        '.diffseek-menu-row:has([data-filter-kind="generated"][data-filter-value="true"]) .diffseek-menu-count',
      )?.textContent,
    ).toContain('1/1');
  });

  it('updates visible counts when files are filtered out', () => {
    const element = menu();
    const state = filters();
    state.get('groups')?.add('Tests');

    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: vi.fn(),
    });

    expect(
      element.querySelector(
        '.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="Tests"]) .diffseek-menu-count',
      )?.textContent,
    ).toContain('0/1');
    expect(
      element.querySelector(
        '.diffseek-menu-row:has([data-filter-kind="statuses"][data-filter-value="modified"]) .diffseek-menu-count',
      )?.textContent,
    ).toContain('1/2');
  });

  it('removes a shared owner prefix from two or more mapped owners', () => {
    const element = menu();
    const ownedFiles = files.map((file, index) => ({
      ...file,
      labels: file.labels.map((label) =>
        label.facet === 'owners' && label.value !== 'Unmapped'
          ? {
              ...label,
              value:
                index === 0 ? '@team/backend' : '@team/platform',
            }
          : label,
      ),
    }));

    mountFilterMenu(element, {
      files: ownedFiles,
      filters: filters(),
      onChange: vi.fn(),
    });

    const owners = [
      ...element.querySelectorAll<HTMLElement>('[data-filter-kind="owners"]'),
    ];
    expect(owners.map(({ dataset }) => dataset.filterValue)).toEqual([
      '@team/backend',
      '@team/platform',
      'Unmapped',
    ]);
    expect(owners.map((owner) => owner.textContent)).toEqual([
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
      onChange: vi.fn(),
    });

    expect(element.textContent).toContain('@docs');
    expect(element.textContent).toContain('@owner');
  });

  it('keeps owner prefixes when mapped owners belong to different organizations', () => {
    const element = menu();
    const ownedFiles = files.map((file, index) => ({
      ...file,
      labels: file.labels.map((label) =>
        label.facet === 'owners' && label.value !== 'Unmapped'
          ? {
              ...label,
              value:
                index === 0 ? '@team/backend' : '@other/platform',
            }
          : label,
      ),
    }));

    mountFilterMenu(element, {
      files: ownedFiles,
      filters: filters(),
      onChange: vi.fn(),
    });

    expect(element.textContent).toContain('@team/backend');
    expect(element.textContent).toContain('@other/platform');
  });

  it('marks only the currently visible files for a label', () => {
    const element = menu();
    const state = filters();
    const onChange = vi.fn();
    const onViewed = vi.fn();
    state.get('groups')?.add('Tests');

    mountFilterMenu(element, {
      files,
      filters: state,
      onChange,
      onViewed,
    });

    const action = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action][data-viewed-facet="statuses"][data-viewed-value="modified"]',
    );
    const counter = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-count-action][data-viewed-facet="statuses"][data-viewed-value="modified"]',
    );
    expect(
      element.querySelector(
        '[data-diffseek-menu-viewed-action][data-viewed-facet="groups"][data-viewed-value="Tests"]',
      ),
    ).toBeNull();
    expect(action?.title).toBe('Mark as viewed');
    expect(counter?.title).toBe('Mark as viewed');
    counter?.click();
    expect(onViewed).toHaveBeenCalledWith(true, ['unmapped.txt']);
    onViewed.mockClear();
    action?.click();
    expect(onViewed).toHaveBeenCalledWith(true, ['unmapped.txt']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers to mark a fully viewed visible label as not viewed', () => {
    const element = menu();
    const onViewed = vi.fn();

    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: vi.fn(),
      onViewed,
    });

    const action = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action][data-viewed-facet="generated"][data-viewed-value="true"]',
    );
    const counter = element.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-count-action][data-viewed-facet="generated"][data-viewed-value="true"]',
    );
    expect(action?.title).toBe('Mark as not viewed');
    expect(counter?.title).toBe('Mark as not viewed');
    counter?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
    onViewed.mockClear();
    action?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
  });

  it('offers hidden viewed files as a category escape action', () => {
    const element = menu();
    const state = filters();
    const onViewed = vi.fn();
    const sharedOwnerFiles = files.map((file) =>
      file.path === 'docs/guide.md'
        ? {
            ...file,
            labels: file.labels.map((label) =>
              label.facet === 'owners'
                ? { ...label, value: '@owner' }
                : label,
            ),
          }
        : file,
    );
    state.get('viewed')?.add('true');

    mountFilterMenu(element, {
      files: sharedOwnerFiles,
      filters: state,
      onChange: vi.fn(),
      onViewed,
    });

    const row = element.querySelector(
      '.diffseek-menu-row:has([data-filter-kind="owners"][data-filter-value="@owner"])',
    );
    const action = row?.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action]',
    );
    const counter = row?.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-count-action]',
    );
    expect(counter?.textContent).toBe('1/2');
    expect(action?.title).toBe('Mark as not viewed');
    expect(counter?.title).toBe('Mark as not viewed');
    counter?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
    onViewed.mockClear();
    action?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
  });

  it('keeps a selected value available when it is not currently observed', () => {
    const element = menu();
    const state = filters();
    state.get('groups')?.add('Unavailable');

    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: vi.fn(),
    });

    expect(
      element.querySelector(
        '[data-filter-kind="groups"][data-filter-value="Unavailable"]',
      ),
    ).not.toBeNull();
  });

  it('supports roving keys without menu-level actions', () => {
    const element = menu();
    const state = filters();
    state.get('groups')?.add('Tests');

    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: vi.fn(),
    });
    const first = element.querySelector<HTMLButtonElement>(
      '[data-diffseek="filters"] button',
    );
    first?.focus();
    first?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(document.activeElement).toBe(
      [...element.querySelectorAll('[data-diffseek="filters"] button')].at(-1),
    );
  });
});

describe('filter menu fallback sections', () => {
  it('hides sections whose only choice is their fallback', () => {
    const element = menu();
    const fallbackOnly: FileRecord = {
      ...files[2]!,
      labels: [
        { facet: 'groups', value: 'No type' },
        { facet: 'owners', value: 'Unmapped' },
        { facet: 'languages', value: 'No extension' },
        { facet: 'generated', value: 'false' },
        { facet: 'statuses', value: 'modified' },
      ],
    };

    mountFilterMenu(element, {
      files: [fallbackOnly],
      filters: filters(),
      onChange: vi.fn(),
    });

    expect(
      [...element.querySelectorAll('.diffseek-menu-section h3')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(['Change status']);
    expect(element.textContent).not.toContain('No owner');
    expect(element.textContent).not.toContain('No type');
    expect(element.textContent).not.toContain('No extension');
  });

  it('shows a fallback section when another choice exists', () => {
    const element = menu();
    const typed = files[0]!;
    const untyped: FileRecord = {
      ...files[2]!,
      labels: [
        { facet: 'groups', value: 'No type' },
        { facet: 'owners', value: 'Unmapped' },
        { facet: 'languages', value: 'No extension' },
        { facet: 'generated', value: 'false' },
        { facet: 'statuses', value: 'modified' },
      ],
    };

    mountFilterMenu(element, {
      files: [typed, untyped],
      filters: filters(),
      onChange: vi.fn(),
    });

    expect(
      element.querySelector(
        '[data-filter-kind="groups"][data-filter-value="No type"]',
      ),
    ).not.toBeNull();
    expect(
      [
        ...element.querySelectorAll('[data-filter-kind="groups"]'),
      ].map((item) => item.getAttribute('data-filter-value')),
    ).toEqual(['Tests', 'No type']);
  });
});
