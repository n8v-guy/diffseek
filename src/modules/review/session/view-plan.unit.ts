import { describe, expect, it } from 'vitest';

import { emptyFacetExclusions } from '../filtering/facets';
import type { FileRecord, FilterState } from '../model/file';

import { changedSurfaces, planView, type ViewInputs } from './view-plan';

function file(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    path: 'src/app.ts',
    anchor: 'diff-src/app.ts',
    extension: '.ts',
    owners: [],
    generated: false,
    status: 'modified',
    viewed: false,
    capabilities: { collapse: true, viewed: true },
    labels: [{ facet: 'languages', value: 'TypeScript' }],
    ...overrides,
  };
}

function inputs(overrides: Partial<ViewInputs> = {}): ViewInputs {
  return {
    files: [file()],
    filters: emptyFacetExclusions(),
    filterDefaults: { hidden: new Set(), viewed: new Set() },
    generatedDefaultBusy: false,
    ...overrides,
  };
}

function changes(overrides: Partial<ViewInputs>) {
  return changedSurfaces(planView(inputs()), planView(inputs(overrides)));
}

describe('view plan', () => {
  it('gives equal plans for equal inputs and reads them without writing', () => {
    const frozen = inputs({ files: Object.freeze([Object.freeze(file())]) });
    expect(planView(frozen)).toEqual(planView(inputs()));
    expect(changes({})).toEqual({ page: false, menu: false });
  });

  it('is independent of set insertion order', () => {
    const forward = new Set(['viewed', 'generated']);
    const backward = new Set(['generated', 'viewed']);
    expect(
      changes({ filterDefaults: { hidden: forward, viewed: new Set() } }),
    ).toEqual({ page: false, menu: true });
    expect(
      changedSurfaces(
        planView(inputs({ filterDefaults: { hidden: forward, viewed: new Set() } })),
        planView(inputs({ filterDefaults: { hidden: backward, viewed: new Set() } })),
      ),
    ).toEqual({ page: false, menu: false });
  });

  it('changes the page when what a tree row or panel shows changes', () => {
    const excluded: FilterState = emptyFacetExclusions();
    excluded.get('languages')?.add('TypeScript');
    const page = { page: true, menu: true };
    expect(changes({ files: [file({ viewed: true })] })).toEqual(page);
    expect(changes({ files: [file({ path: 'src/other.ts' })] })).toEqual(page);
    expect(changes({ files: [file({ capabilities: { collapse: false, viewed: true } })] })).toEqual(page);
    expect(changes({ files: [file({ labels: [] })] })).toEqual(page);
    expect(changes({ filters: excluded })).toEqual(page);
  });

  it('changes only the menu when only menu content changes', () => {
    const menuOnly = { page: false, menu: true };
    expect(changes({ generatedDefaultBusy: true })).toEqual(menuOnly);
    expect(changes({ files: [file({ extension: null })] })).toEqual(menuOnly);
    expect(changes({ files: [file({ anchor: 'diff-other' })] })).toEqual(menuOnly);
    expect(changes({ files: [file({ owners: ['@team'] })] })).toEqual(menuOnly);
  });

  it('treats a first plan as a change to every surface', () => {
    expect(changedSurfaces(null, planView(inputs()))).toEqual({ page: true, menu: true });
  });
});
