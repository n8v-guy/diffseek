import { describe, expect, it } from 'vitest';

import type { FileRecord } from '../model/file';

import { emptyFacetExclusions } from './facets';
import {
  includeCountedFiles,
  scopeAriaPressed,
  scopeViewedLabel,
  viewedMark,
} from './viewed-scope';

function file(
  path: string,
  options: {
    viewed?: boolean;
    generated?: boolean;
    labels?: FileRecord['labels'];
    capability?: boolean;
  } = {},
): FileRecord {
  return {
    path,
    anchor: `diff-${path}`,
    extension: '.ts',
    owners: [],
    generated: options.generated === true,
    status: 'modified',
    viewed: options.viewed === true,
    capabilities: { collapse: true, viewed: options.capability !== false },
    labels: options.labels ?? [],
  };
}

describe('viewed scope', () => {
  it('describes empty, partial, and filled circles', () => {
    expect(viewedMark(0, 20)).toBe('empty');
    expect(viewedMark(12, 20)).toBe('partial');
    expect(viewedMark(20, 20)).toBe('filled');
    expect(scopeAriaPressed(0, 20)).toBe('false');
    expect(scopeAriaPressed(12, 20)).toBe('mixed');
    expect(scopeAriaPressed(20, 20)).toBe('true');
    expect(scopeViewedLabel(12, 20)).toBe(
      'Mark 8 remaining as viewed (12 of 20 viewed)',
    );
    expect(scopeViewedLabel(0, 3)).toBe(
      'Mark 3 remaining as viewed (0 of 3 viewed)',
    );
    expect(scopeViewedLabel(20, 20)).toBe('Mark as not viewed');
  });

  it('counts files hidden only by the viewed filter', () => {
    const filters = emptyFacetExclusions();
    filters.get('viewed')?.add('true');
    filters.get('generated')?.add('true');
    filters.get('owners')?.add('@other');
    filters.get('groups')?.add('Tests');
    filters.get('languages')?.add('sql');
    const include = includeCountedFiles(filters);
    const viewed = file('web/src/app/App.tsx', {
      viewed: true,
      labels: [
        { facet: 'viewed', value: 'true' },
        { facet: 'owners', value: '@acme/web-platform' },
        { facet: 'groups', value: 'App' },
        { facet: 'languages', value: 'TypeScript' },
        { facet: 'generated', value: 'false' },
      ],
    });
    const unread = file('web/src/app/routes.tsx', {
      labels: [
        { facet: 'owners', value: '@acme/web-platform' },
        { facet: 'groups', value: 'App' },
        { facet: 'languages', value: 'TypeScript' },
        { facet: 'generated', value: 'false' },
      ],
    });
    const generated = file('web/src/generated.ts', {
      generated: true,
      labels: [
        { facet: 'generated', value: 'true' },
        { facet: 'owners', value: '@acme/web-platform' },
      ],
    });
    const otherOwner = file('services/other/note.ts', {
      labels: [
        { facet: 'owners', value: '@other' },
        { facet: 'generated', value: 'false' },
      ],
    });
    const sql = file('services/payments/db/schema.sql', {
      labels: [
        { facet: 'languages', value: 'sql' },
        { facet: 'owners', value: '@acme/payments' },
        { facet: 'generated', value: 'false' },
      ],
    });
    const tests = file('web/src/app/app.test.ts', {
      labels: [
        { facet: 'groups', value: 'Tests' },
        { facet: 'generated', value: 'false' },
      ],
    });
    const stub = file('web/src/app/stub.ts', {
      capability: false,
      labels: [{ facet: 'generated', value: 'false' }],
    });

    expect(include(viewed)).toBe(true);
    expect(include(unread)).toBe(true);
    expect(include(generated)).toBe(false);
    expect(include(otherOwner)).toBe(false);
    expect(include(sql)).toBe(false);
    expect(include(tests)).toBe(false);
    expect(include(stub)).toBe(false);
  });

  it('lets the generated row count files its own filter is hiding', () => {
    const filters = emptyFacetExclusions();
    filters.get('generated')?.add('true');
    filters.get('viewed')?.add('true');
    filters.get('owners')?.add('@other');
    const include = includeCountedFiles(filters, ['generated']);
    const hiddenGenerated = file('src/generated.ts', {
      generated: true,
      labels: [
        { facet: 'generated', value: 'true' },
        { facet: 'owners', value: '@acme/web-platform' },
      ],
    });
    const viewedGenerated = file('src/generated-viewed.ts', {
      generated: true,
      viewed: true,
      labels: [
        { facet: 'generated', value: 'true' },
        { facet: 'viewed', value: 'true' },
        { facet: 'owners', value: '@acme/web-platform' },
      ],
    });
    const otherOwner = file('src/other-generated.ts', {
      generated: true,
      labels: [
        { facet: 'generated', value: 'true' },
        { facet: 'owners', value: '@other' },
      ],
    });

    expect(include(hiddenGenerated)).toBe(true);
    expect(include(viewedGenerated)).toBe(true);
    expect(include(otherOwner)).toBe(false);
    expect(includeCountedFiles(filters)(hiddenGenerated)).toBe(false);
  });
});
