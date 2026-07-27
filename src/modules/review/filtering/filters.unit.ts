import { describe, expect, it } from 'vitest';

import type { FileRecord, FilterState } from '../model/file';

import { emptyFacetExclusions } from './facets';
import { matchesFilters } from './filters';

const file: FileRecord = {
  path: 'src/app.test.ts',
  anchor: 'diff-app',
  extension: '.ts',
  owners: ['@owner', '@org/team'],
  generated: false,
  status: 'modified',
  viewed: false,
  capabilities: { collapse: true, viewed: true },
  labels: [
    { facet: 'viewed', value: 'true' },
    { facet: 'groups', value: 'Tests' },
    { facet: 'owners', value: '@owner' },
    { facet: 'owners', value: '@org/team' },
    { facet: 'languages', value: 'ts' },
    { facet: 'generated', value: 'false' },
    { facet: 'statuses', value: 'modified' },
  ],
};

const emptyFilters = (): FilterState => emptyFacetExclusions();

describe('matchesFilters', () => {
  it('matches when every excluded category misses', () => {
    const filters = emptyFilters();
    filters.get('groups')?.add('Docs');
    filters.get('owners')?.add('@other');
    filters.get('statuses')?.add('added');

    expect(matchesFilters(file, filters)).toBe(true);
  });

  it('uses OR within a category', () => {
    const filters = emptyFilters();
    filters.get('owners')?.add('@owner');

    expect(matchesFilters(file, filters)).toBe(true);
    filters.get('owners')?.add('@org/team');
    expect(matchesFilters(file, filters)).toBe(false);
  });

  it('uses AND across categories', () => {
    const filters = emptyFilters();
    filters.get('groups')?.add('Tests');
    filters.get('statuses')?.add('added');

    expect(matchesFilters(file, filters)).toBe(false);
  });

  it('does not constrain inactive categories', () => {
    expect(matchesFilters(file, emptyFilters())).toBe(true);
  });

  it('hides viewed files when the viewed choice is excluded', () => {
    const filters = emptyFilters();
    filters.get('viewed')?.add('true');

    expect(matchesFilters(file, filters)).toBe(false);
    expect(
      matchesFilters(
        {
          ...file,
          viewed: false,
          labels: file.labels.filter((label) => label.facet !== 'viewed'),
        },
        filters,
      ),
    ).toBe(true);
  });
});
