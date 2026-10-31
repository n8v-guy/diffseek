import { describe, expect, it } from 'vitest';

import type { FileRecord } from '../model/file';

import { emptyFacetExclusions } from './facets';
import {
  categoryViewedNotice,
  folderViewedNotice,
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
    expect(scopeViewedLabel(12, 38, 'payments')).toBe(
      'Mark 26 remaining in payments as viewed (12 of 38 viewed)',
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

  it('announces tree folders and menu categories differently', () => {
    expect(folderViewedNotice('checkout', true, 8)).toBe(
      'Marked 8 visible files in checkout viewed',
    );
    expect(folderViewedNotice('checkout', false, 8)).toBe(
      'Unmarked 8 visible files in checkout',
    );
    expect(folderViewedNotice('src', true, 1)).toBe(
      'Marked 1 visible file in src viewed',
    );
    expect(categoryViewedNotice('payments', true, 26, 4)).toBe(
      'Marked all 26 payments files viewed (4 hidden)',
    );
    expect(categoryViewedNotice('payments', false, 38)).toBe(
      'Unmarked all 38 payments files',
    );
    expect(categoryViewedNotice('Generated files', true, 1, 1)).toBe(
      'Marked all 1 Generated file viewed (1 hidden)',
    );
  });
});
