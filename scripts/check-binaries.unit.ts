import { describe, expect, it } from 'vitest';

import { findBinaryPaths } from './binary-paths';

describe('binary file check', () => {
  it('reports only paths git counts as binary', () => {
    expect(
      findBinaryPaths(
        '12\t3\tsrc/app.ts\0-\t-\tdocs/shot.png\0' +
          '0\t0\tempty.txt\0-\t-\tdir/name with\ttab.bin\0',
      ),
    ).toStrictEqual(['docs/shot.png', 'dir/name with\ttab.bin']);
  });

  it('accepts text-only output', () => {
    expect(findBinaryPaths('')).toStrictEqual([]);
    expect(findBinaryPaths('4\t1\tREADME.md\0')).toStrictEqual([]);
  });
});
