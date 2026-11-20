import { beforeEach, describe, expect, it } from 'vitest';

import {
  restoreFilterSelection,
  saveFilterSelection,
} from './filter-selection';

const review = 'octo/repo#7';
const key = `diffseek:filters:${review}`;

function empty(): Map<string, Set<string>> {
  return new Map([
    ['groups', new Set<string>()],
    ['viewed', new Set<string>()],
  ]);
}

describe('filter selection', () => {
  beforeEach(() => sessionStorage.clear());

  it('hides the default facets when this tab saved nothing for the review', () => {
    const filters = empty();

    restoreFilterSelection(document, review, filters, ['viewed']);

    expect(filters).toEqual(
      new Map([
        ['groups', new Set()],
        ['viewed', new Set(['true'])],
      ]),
    );
  });

  it('restores the saved selection per review, including a shown default facet', () => {
    saveFilterSelection(
      document,
      review,
      new Map([
        ['groups', new Set(['Tests'])],
        ['viewed', new Set<string>()],
      ]),
    );
    const filters = empty();
    const other = empty();

    restoreFilterSelection(document, review, filters, ['viewed']);
    restoreFilterSelection(document, 'octo/repo#8', other, ['viewed']);

    expect(sessionStorage.getItem(key)).toBe('{"groups":["Tests"],"viewed":[]}');
    expect(filters).toEqual(
      new Map([
        ['groups', new Set(['Tests'])],
        ['viewed', new Set()],
      ]),
    );
    expect(other.get('viewed')).toEqual(new Set(['true']));
  });

  it('falls back to the defaults on unreadable records and skips non-string values', () => {
    sessionStorage.setItem(key, '{');
    const unreadable = empty();
    restoreFilterSelection(document, review, unreadable, ['viewed']);
    expect(unreadable.get('viewed')).toEqual(new Set(['true']));

    sessionStorage.setItem(key, '{"groups":["Docs",3],"viewed":"true"}');
    const filters = empty();
    restoreFilterSelection(document, review, filters, ['viewed']);
    expect(filters).toEqual(
      new Map([
        ['groups', new Set(['Docs'])],
        ['viewed', new Set()],
      ]),
    );
  });
});
