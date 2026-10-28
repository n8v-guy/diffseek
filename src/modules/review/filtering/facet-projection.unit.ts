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
      counted: 1,
      paths: ['src/app.ts'],
      total: 2,
      viewedCount: 0,
      viewedState: 'empty',
      visible: 1,
    });
    expect(projectFacet('groups', files, filters).get('Tests')).toEqual({
      counted: 0,
      paths: [],
      total: 1,
      viewedCount: 0,
      viewedState: 'empty',
      visible: 0,
    });
  });

  it('treats a partially viewed scope as half marked', () => {
    const files = [
      file('src/first.ts', [{ facet: 'groups', value: 'Code' }], true),
      file('src/second.ts', [{ facet: 'groups', value: 'Code' }]),
    ];

    expect(
      projectFacet('groups', files, emptyFacetExclusions()).get('Code'),
    ).toMatchObject({
      counted: 2,
      paths: ['src/second.ts'],
      viewedCount: 1,
      viewedState: 'partial',
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
      counted: 1,
      paths: ['src/ready.ts'],
      total: 2,
      viewedCount: 0,
      viewedState: 'empty',
      visible: 2,
    });
  });

  it('counts viewed files hidden only by the viewed filter', () => {
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

    expect(projectFacet('groups', files, filters).get('Code')).toEqual({
      counted: 2,
      paths: ['src/visible.ts'],
      total: 3,
      viewedCount: 1,
      viewedState: 'partial',
      visible: 1,
    });
  });

  it('clears every counted file when the circle is filled', () => {
    const files = [
      file(
        'src/hidden-viewed.ts',
        [
          { facet: 'viewed', value: 'true' },
          { facet: 'groups', value: 'Code' },
        ],
        true,
      ),
      file(
        'src/also-viewed.ts',
        [
          { facet: 'viewed', value: 'true' },
          { facet: 'groups', value: 'Code' },
        ],
        true,
      ),
    ];
    const filters = emptyFacetExclusions();
    filters.get('viewed')?.add('true');

    expect(projectFacet('groups', files, filters).get('Code')).toMatchObject({
      counted: 2,
      paths: ['src/hidden-viewed.ts', 'src/also-viewed.ts'],
      viewedCount: 2,
      viewedState: 'filled',
      visible: 0,
    });
  });
});
