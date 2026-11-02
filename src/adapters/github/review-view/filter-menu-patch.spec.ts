import type { FileRecord } from '@diffseek/review';

import { describe, expect, it } from 'vitest';

import { mountFilterMenu } from './filter-menu';
import {
  changeHandler,
  files,
  filters,
  menu,
  viewedHandler,
} from './filter-menu.fixture';

const modifiedCount =
  '[data-diffseek-menu-count-action][data-viewed-facet="statuses"][data-viewed-value="modified"]';
const ownersAll =
  '.diffseek-menu-section:has([data-filter-kind="owners"]) [data-filter-all]';

function markAppViewed(file: FileRecord): FileRecord {
  if (file.path !== 'src/app.test.ts') return file;
  return {
    ...file,
    labels: [
      { facet: 'viewed', value: 'true' },
      ...file.labels.filter((label) => label.facet !== 'viewed'),
    ],
    viewed: true,
  };
}

describe('filter menu in-place patch', () => {
  it('updates counts and viewed actions without replacing the menu root', () => {
    const element = menu();
    const state = filters();
    const onViewed = viewedHandler();
    mountFilterMenu(element, {
      files,
      filters: state,
      onChange: changeHandler(),
      onViewed,
    });
    const root = element.querySelector('[data-diffseek="filters"]');
    expect(element.querySelector(modifiedCount)?.textContent).toContain('2/2');

    mountFilterMenu(element, {
      files: files.map((file) => markAppViewed(file)),
      filters: state,
      onChange: changeHandler(),
      onViewed,
    });

    expect(element.querySelector('[data-diffseek="filters"]')).toBe(root);
    expect(element.querySelector(modifiedCount)?.textContent).toContain('2/2');
    element.querySelector<HTMLButtonElement>(modifiedCount)?.click();
    expect(onViewed).toHaveBeenCalledExactlyOnceWith(true, ['unmapped.txt']);
  });

  it('keeps the generated row circle while generated files are hidden', () => {
    const element = menu();
    const state = filters();
    const onViewed = viewedHandler();
    state.get('generated')?.add('true');
    mountFilterMenu(element, {
      files,
      filterDefaults: {
        hidden: new Set(['generated']),
        viewed: new Set(['generated']),
      },
      filters: state,
      onChange: changeHandler(),
      onViewed,
    });

    const row = element.querySelector(
      '.diffseek-menu-row:has([data-filter-kind="generated"])',
    );
    const action = row?.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-viewed-action]',
    );
    const counter = row?.querySelector<HTMLButtonElement>(
      '[data-diffseek-menu-count-action]',
    );
    const pill = row?.querySelector('[data-diffseek-always-read]');
    expect(counter?.textContent).toBe('0/1');
    expect(action?.title).toBe('Unmark all');
    expect(action?.getAttribute('aria-pressed')).toBe('true');
    expect(action?.classList.contains('diffseek-viewed-partial')).toBe(false);
    expect(pill).not.toBeNull();
    expect(action).not.toBe(pill);
    action?.click();
    expect(onViewed).toHaveBeenCalledWith(false, ['docs/guide.md']);
  });

  it('rebuilds when section all shortcuts appear or disappear', () => {
    const element = menu();
    const state = filters();
    const render = (): void => {
      mountFilterMenu(element, {
        files,
        filters: state,
        onChange: changeHandler(),
        onViewed: viewedHandler(),
      });
    };

    render();
    expect(element.querySelector(ownersAll)).toBeNull();

    state.get('owners')?.add('@owner');
    render();
    expect(element.querySelector(ownersAll)).not.toBeNull();

    state.get('owners')?.delete('@owner');
    render();
    expect(element.querySelector(ownersAll)).toBeNull();
  });
});
