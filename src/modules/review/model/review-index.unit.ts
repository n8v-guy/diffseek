import { describe, expect, it } from 'vitest';

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
  return {
    path,
    anchor: `diff-${path}`,
    extension: '.ts',
    owners: [],
    generated: false,
    status: 'modified',
    viewed: false,
    capabilities: { collapse: true, viewed: true },
    labels: [],
  };
}
