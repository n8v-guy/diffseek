import type { FileRecord, FilterState } from '@diffseek/review';

import { describe, expect, it } from 'vitest';

import { mountFilterMenu } from './filter-menu';
import {
  changeHandler,
  files,
  filters,
  menu,
  viewedHandler,
} from './filter-menu.fixture';

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
