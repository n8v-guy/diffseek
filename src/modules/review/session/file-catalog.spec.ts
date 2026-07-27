import { describe, expect, it } from 'vitest';

import type { FileRecord } from '../model/file';

import { FileCatalog } from './file-catalog';

function file(path: string, viewed = false): FileRecord {
  return {
    path,
    anchor: `diff-${path}`,
    extension: '.ts',
    owners: [],
    generated: false,
    status: 'modified',
    viewed,
    capabilities: { collapse: true, viewed: true },
    labels: [],
  };
}

describe('FileCatalog', () => {
  it('retains temporarily unmounted files and refreshes observed records', () => {
    const catalog = new FileCatalog();
    catalog.merge([file('src/first.ts'), file('src/second.ts')]);

    catalog.merge([file('src/first.ts', true)]);

    expect(catalog.files().map(({ path }) => path)).toEqual([
      'src/first.ts',
      'src/second.ts',
    ]);
    expect(catalog.files()[0]?.viewed).toBe(true);
  });
});
