import { describe, expect, it } from 'vitest';

import type { FileRecord } from '../model/file';

import { projectFacet } from './facet-projection';
import { emptyFacetExclusions } from './facets';

function file(
  path: string,
  labels: FileRecord['labels'],
  viewed = false,
): FileRecord {
  return {
    path,
    anchor: `diff-${path}`,
    extension: '.ts',
    owners: [],
    generated: false,
    status: 'modified',
    viewed,
    capabilities: { collapse: true, viewed: true },
    labels,
  };
}

describe('projectFacet', () => {
  it('reports visible and total files for each label value', () => {
    const files = [
      file('src/app.ts', [
        { facet: 'groups', value: 'Code' },
        { facet: 'owners', value: '@org/backend' },
      ]),
      file(
        'src/app.test.ts',
        [
          { facet: 'groups', value: 'Tests' },
          { facet: 'owners', value: '@org/backend' },
        ],
        true,
      ),
    ];
    const filters = emptyFacetExclusions();
    filters.get('groups')?.add('Tests');

    expect(projectFacet('owners', files, filters).get('@org/backend')).toEqual({
      hiddenViewedPaths: [],
      paths: ['src/app.ts'],
      total: 2,
      viewed: false,
      visible: 1,
    });
    expect(projectFacet('groups', files, filters).get('Tests')).toEqual({
      hiddenViewedPaths: [],
      paths: [],
      total: 1,
      viewed: false,
      visible: 0,
    });
  });

  it('treats a partially viewed visible scope as markable viewed', () => {
    const files = [
      file('src/first.ts', [{ facet: 'groups', value: 'Code' }], true),
      file('src/second.ts', [{ facet: 'groups', value: 'Code' }]),
    ];

    expect(
      projectFacet('groups', files, emptyFacetExclusions()).get('Code'),
    ).toMatchObject({
      paths: ['src/first.ts', 'src/second.ts'],
      viewed: false,
      visible: 2,
    });
  });

  it('omits capability-less stubs from viewed action paths', () => {
    const stub: FileRecord = {
      ...file('src/stub.ts', [{ facet: 'generated', value: 'true' }]),
      capabilities: { collapse: false, viewed: false },
    };
    const ready = file('src/ready.ts', [{ facet: 'generated', value: 'true' }]);

    expect(
      projectFacet('generated', [stub, ready], emptyFacetExclusions()).get(
        'true',
      ),
    ).toMatchObject({
      paths: ['src/ready.ts'],
      total: 2,
      visible: 2,
      viewed: false,
    });
  });

  it('reports viewed paths hidden only by the viewed facet', () => {
    const files = [
      file('src/visible.ts', [
        { facet: 'groups', value: 'Code' },
        { facet: 'statuses', value: 'modified' },
      ]),
      file(
        'src/hidden-viewed.ts',
        [
          { facet: 'viewed', value: 'true' },
          { facet: 'groups', value: 'Code' },
          { facet: 'statuses', value: 'modified' },
        ],
        true,
      ),
      file(
        'src/hidden-by-status.ts',
        [
          { facet: 'viewed', value: 'true' },
          { facet: 'groups', value: 'Code' },
          { facet: 'statuses', value: 'added' },
        ],
        true,
      ),
    ];
    const filters = emptyFacetExclusions();
    filters.get('viewed')?.add('true');
    filters.get('statuses')?.add('added');

    expect(projectFacet('groups', files, filters).get('Code')).toMatchObject({
      hiddenViewedPaths: ['src/hidden-viewed.ts'],
      paths: ['src/visible.ts'],
      total: 3,
      viewed: false,
      visible: 1,
    });
  });
});
