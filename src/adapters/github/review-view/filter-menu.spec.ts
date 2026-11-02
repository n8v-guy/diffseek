import { describe, expect, it } from 'vitest';

import type { FileRecord } from '@diffseek/review';

import { mountFilterMenu } from './filter-menu';
import {
  changeHandler,
  fallbackLabels,
  fileAt,
  files,
  filters,
  menu,
  menuExcludingGroup,
  viewedHandler,
  withoutGenerated,
} from './filter-menu.fixture';

describe('mountFilterMenu ownership', () => {
  it('owns the menu contents while retaining hidden native items', () => {
    const element = menu();
    const state = filters();
    const onChange = changeHandler();

    mountFilterMenu(element, { files, filters: state, onChange });
    mountFilterMenu(element, { files, filters: state, onChange });

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
    expect(element.textContent).toContain('Groups');
    expect(element.textContent).toContain('Owners');
    expect(element.textContent).toContain('Formats');
    expect(element.textContent).toContain('Viewed files');
    expect(element.textContent).toContain('Generated files');
    expect(element.textContent).toContain('Change status');
    expect(sectionHeadings(element)).toStrictEqual([
      'Owners',
      'Groups',
      'Formats',
      'Change status',
    ]);
    expect(
      element
        .querySelector('[data-filter-kind="generated"][data-filter-value="true"]')
        ?.closest('.diffseek-menu-section'),
    ).toBeNull();
    expect(element.querySelectorAll('[data-diffseek-separator]')).toHaveLength(4);
    expect(topLevelKinds(element)).toStrictEqual(['viewed', 'generated']);
    expect(ownerValues(element)).toStrictEqual(['@docs', '@owner', 'Unmapped']);
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
    const onClear = changeHandler();
    clear.addEventListener('click', onClear);
    element.append(clear);

    mountFilterMenu(element, {
      files,
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(onClear).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent));
    expect(element.querySelector('[data-diffseek="filters"]')).toBeNull();
    expect(element.querySelector('[data-diffseek-native-hidden]')).toBeNull();
  });

  it('omits the generated-files choice when no generated files exist', () => {
    const element = menu();

    mountFilterMenu(element, {
      files: withoutGenerated(files),
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(element.querySelector('[data-filter-kind="generated"]')).toBeNull();
    expect(element.textContent).not.toContain('Generated files');
  });
});

function ownerValues(element: ParentNode): (string | undefined)[] {
  return [...element.querySelectorAll('[data-filter-kind="owners"]')].map(
    (item) => (item instanceof HTMLElement ? item.dataset['filterValue'] : undefined),
  );
}

function sectionHeadings(element: ParentNode): (null | string)[] {
  return [...element.querySelectorAll('.diffseek-menu-section h3')].map(
    (heading) => heading.textContent,
  );
}

function topLevelKinds(element: ParentNode): (string | undefined)[] {
  return [
    ...element.querySelectorAll<HTMLElement>(
      '[data-diffseek="filters"] > .diffseek-menu-content > .diffseek-menu-row [data-filter-kind]',
    ),
  ].map((item) => item.dataset['filterKind']);
}

describe('filter menu fallback sections', () => {
  it('hides sections whose only choice is their fallback', () => {
    const element = menu();
    const fallbackOnly: FileRecord = {
      ...fileAt(2),
      labels: fallbackLabels,
    };

    mountFilterMenu(element, {
      files: [fallbackOnly],
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(
      [...element.querySelectorAll('.diffseek-menu-section h3')].map(
        (heading) => heading.textContent,
      ),
    ).toStrictEqual(['Change status']);
    expect(element.textContent).not.toContain('No owner');
    expect(element.textContent).not.toContain('No groups');
    expect(element.textContent).not.toContain('No extension');
  });

  it('shows a fallback section when another choice exists', () => {
    const element = menu();
    const untyped: FileRecord = {
      ...fileAt(2),
      labels: fallbackLabels,
    };

    mountFilterMenu(element, {
      files: [fileAt(0), untyped],
      filters: filters(),
      onChange: changeHandler(),
    });

    expect(
      element.querySelector(
        '[data-filter-kind="groups"][data-filter-value="No groups"]',
      ),
    ).not.toBeNull();
    expect(
      [...element.querySelectorAll<HTMLElement>('[data-filter-kind="groups"]')].map(
        (item) => item.dataset['filterValue'],
      ),
    ).toStrictEqual(['Tests', 'No groups']);
  });
});

describe('mountFilterMenu focus', () => {
  it('keeps a selected value available when it is not currently observed', () => {
    const element = menu();
    const state = filters();
    state.get('groups')?.add('Unavailable');

    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: changeHandler(),
    });

    expect(
      element.querySelector(
        '[data-filter-kind="groups"][data-filter-value="Unavailable"]',
      ),
    ).not.toBeNull();
  });

  it('supports roving keys without menu-level actions', () => {
    const element = menuExcludingGroup('Tests');
    const first = element.querySelector<HTMLButtonElement>(
      '[data-diffseek="filters"] button',
    );
    first?.focus();
    first?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'End' }),
    );
    expect(document.activeElement).toBe(
      [...element.querySelectorAll('[data-diffseek="filters"] button')].at(-1),
    );
  });
});

function onlyButton(element: ParentNode, value: string): HTMLButtonElement | null {
  return element.querySelector<HTMLButtonElement>(
    `.diffseek-menu-row:has([data-filter-kind="groups"][data-filter-value="${CSS.escape(value)}"]) [data-filter-only]`,
  );
}

describe('filter menu only focus', () => {
  it('presses the only pill whose focus is applied and updates it in place', () => {
    const element = menu();
    const state = filters();
    const render = (): void => {
      mountFilterMenu(element, {
        files,
        filters: state,
        onChange: render,
        onViewed: viewedHandler(),
      });
    };

    render();
    onlyButton(element, 'Tests')?.click();
    expect(onlyButton(element, 'Tests')?.getAttribute('aria-pressed')).toBe('true');
    expect(onlyButton(element, 'Docs')?.getAttribute('aria-pressed')).toBe('false');

    const testsOnly = onlyButton(element, 'Tests');
    state.get('groups')?.delete('Docs');
    state.get('groups')?.add('Tests');
    render();
    expect(onlyButton(element, 'Tests')).toBe(testsOnly);
    expect(testsOnly?.getAttribute('aria-pressed')).toBe('false');
    expect(onlyButton(element, 'Docs')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('mountFilterMenu selection', () => {
  it('starts observed values checked and unchecks an excluded value', () => {
    const element = menu();
    const state = filters();
    const onChange = changeHandler();
    mountFilterMenu(element, { files, filters: state, onChange });

    const tests = element.querySelector<HTMLElement>(
      '[data-filter-kind="groups"][data-filter-value="Tests"]',
    );
    expect(tests?.getAttribute('aria-checked')).toBe('true');
    tests?.click();
    expect(state.get('groups')).toStrictEqual(new Set(['Tests']));
    expect(tests?.getAttribute('aria-checked')).toBe('false');
    expect(onChange).toHaveBeenCalledExactlyOnceWith();
  });

  it('adds only shortcuts exclusively to multi-item sections', () => {
    const single = menu();
    mountFilterMenu(single, {
      files: [fileAt(0)],
      filters: filters(),
      onChange: changeHandler(),
    });
    expect(single.querySelector('[data-filter-only]')).toBeNull();

    const multiple = menu();
    mountFilterMenu(multiple, {
      files,
      filters: filters(),
      onChange: changeHandler(),
    });
    expect(multiple.querySelector('[data-filter-only]')).not.toBeNull();
  });
});
