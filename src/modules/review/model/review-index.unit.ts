import { describe, expect, it } from 'vitest';

import { emptyFacetExclusions } from '../filtering/facets';
import { includeCountedFiles } from '../filtering/viewed-scope';

import type { FileRecord } from './file';
import { ReviewIndex } from './review-index';

describe('ReviewIndex', () => {
  it('indexes exact files, folder descendants, and visible ancestors', () => {
    const files = [
      file('src/app.ts'),
      file('src/components/button.ts'),
      file('docs/readme.md'),
    ];
    const index = new ReviewIndex(files);

    expect(index.filesUnder('src').map(({ path }) => path)).toEqual([
      'src/app.ts',
      'src/components/button.ts',
    ]);
    expect(index.filesUnder('src/app.ts')).toEqual([files[0]]);
    expect(
      index.visibleItems(['src/components/button.ts', 'missing/file.bin']),
    ).toEqual(
      new Set([
        'src',
        'src/components',
        'src/components/button.ts',
        'missing',
        'missing/file.bin',
      ]),
    );
  });

  it('sums counted files under each folder in one pass', () => {
    const filters = emptyFacetExclusions();
    filters.get('viewed')?.add('true');
    filters.get('generated')?.add('true');
    const files = [
      labeled('web/full/a.ts', true),
      labeled('web/full/b.ts', true),
      labeled('web/full/c.ts', true),
      labeled('web/full/d.ts', true),
      labeled('web/full/e.ts', true),
      labeled('web/full/f.ts', true),
      labeled('web/full/g.ts', true),
      labeled('web/full/h.ts', true),
      labeled('web/full/i.ts', true),
      labeled('web/empty/only.ts', false),
      labeled('web/src/hidden-viewed.ts', true, [
        { facet: 'viewed', value: 'true' },
      ]),
      labeled('web/src/generated.ts', false, [
        { facet: 'generated', value: 'true' },
      ]),
      labeled('services/payments/db/schema.sql', false),
    ];
    let visits = 0;
    const include = includeCountedFiles(filters);
    const folders = new ReviewIndex(files).folderViewed((candidate) => {
      visits += 1;
      return include(candidate);
    });

    expect(visits).toBe(files.length);
    expect(folders.get('web/full')).toMatchObject({ counted: 9, viewed: 9 });
    expect(folders.get('web/empty')).toMatchObject({ counted: 1, viewed: 0 });
    expect(folders.get('web')).toMatchObject({ counted: 11, viewed: 10 });
    expect(folders.get('web/src')).toMatchObject({
      counted: 1,
      viewed: 1,
      unreadPaths: [],
    });
    expect(folders.has('web/src/generated.ts')).toBe(false);
    expect(folders.get('services/payments/db')?.unreadPaths).toEqual([
      'services/payments/db/schema.sql',
    ]);
    expect(folders.get('services')).toMatchObject({ counted: 1, viewed: 0 });
  });

  it.each([100, 500, 2_000])(
    'constructs a %i-file index without quadratic growth',
    (size) => {
      const files = Array.from({ length: size }, (_, index) =>
        file(`packages/package-${index % 25}/src/file-${index}.ts`),
      );

      const started = performance.now();
      const index = new ReviewIndex(files);
      const elapsed = performance.now() - started;

      expect(index.filesUnder('packages')).toHaveLength(size);
      expect(elapsed).toBeLessThan(250);
    },
  );
});

function file(path: string): FileRecord {
  return labeled(path, false);
}

function labeled(
  path: string,
  viewed: boolean,
  labels: FileRecord['labels'] = [{ facet: 'generated', value: 'false' }],
): FileRecord {
  return {
    path,
    anchor: `diff-${path}`,
    extension: '.ts',
    owners: [],
    generated: labels.some(
      (label) => label.facet === 'generated' && label.value === 'true',
    ),
    status: 'modified',
    viewed,
    capabilities: { collapse: true, viewed: true },
    labels: viewed
      ? [{ facet: 'viewed', value: 'true' }, ...labels.filter((label) => label.facet !== 'viewed')]
      : labels.filter((label) => label.facet !== 'viewed'),
  };
}
