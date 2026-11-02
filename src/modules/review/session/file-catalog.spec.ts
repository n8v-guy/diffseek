import { describe, expect, it } from 'vitest';

import type { FileRecord } from '../model/file';

import { FileCatalog } from './file-catalog';

function file(path: string, viewed = false): FileRecord {
  return {
    anchor: `diff-${path}`,
    capabilities: { collapse: true, viewed: true },
    extension: '.ts',
    generated: false,
    labels: [],
    owners: [],
    path,
    status: 'modified',
    viewed,
  };
}

describe('FileCatalog', () => {
  it('retains temporarily unmounted files and refreshes observed records', () => {
    const catalog = new FileCatalog();
    catalog.merge([file('src/first.ts'), file('src/second.ts')]);

    catalog.merge([file('src/first.ts', true)]);

    expect(catalog.files().map(({ path }) => path)).toStrictEqual([
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
        labels: [
          { facet: 'generated', value: 'true' },
          { facet: 'viewed', value: 'true' },
          { facet: 'owners', value: '@octo' },
        ],
        owners: ['@octo'],
      },
    ]);

    catalog.merge([
      {
        ...file('src/generated.ts'),
        capabilities: { collapse: false, viewed: false },
        labels: [],
        owners: [],
        viewed: false,
      },
    ]);

    expect(catalog.files()[0]).toMatchObject({
      capabilities: { collapse: false, viewed: false },
      generated: true,
      labels: [
        { facet: 'generated', value: 'true' },
        { facet: 'viewed', value: 'true' },
        { facet: 'owners', value: '@octo' },
      ],
      owners: ['@octo'],
      viewed: true,
    });
  });
});
