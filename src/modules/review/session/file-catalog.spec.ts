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

  it('keeps classification when a later scan emits a capability-less stub', () => {
    const catalog = new FileCatalog();
    catalog.merge([
      {
        ...file('src/generated.ts', true),
        generated: true,
        owners: ['@octo'],
        labels: [
          { facet: 'generated', value: 'true' },
          { facet: 'viewed', value: 'true' },
          { facet: 'owners', value: '@octo' },
        ],
      },
    ]);

    catalog.merge([
      {
        ...file('src/generated.ts'),
        viewed: false,
        capabilities: { collapse: false, viewed: false },
        owners: [],
        labels: [],
      },
    ]);

    expect(catalog.files()[0]).toMatchObject({
      generated: true,
      viewed: true,
      owners: ['@octo'],
      capabilities: { collapse: false, viewed: false },
      labels: [
        { facet: 'generated', value: 'true' },
        { facet: 'viewed', value: 'true' },
        { facet: 'owners', value: '@octo' },
      ],
    });
  });
});
