import { describe, expect, it } from 'vitest';

import type { FileLabel } from '../classification/labels';

import {
  emptyFacetExclusions,
  facetChoices,
  matchesFacets,
} from './facets';

const labels: FileLabel[] = [
  { facet: 'groups', value: 'Tests' },
  { facet: 'owners', value: '@team' },
  { facet: 'statuses', value: 'added' },
];

describe('filter facets', () => {
  it('excludes unchecked values with OR within and AND across facets', () => {
    const excluded = emptyFacetExclusions();
    excluded.set('groups', new Set(['Docs']));

    expect(matchesFacets(labels, excluded)).toBe(true);
    excluded.set('groups', new Set(['Docs', 'Tests']));
    expect(matchesFacets(labels, excluded)).toBe(false);
    excluded.set('owners', new Set(['@team']));
    expect(matchesFacets(labels, excluded)).toBe(false);
  });

  it('keeps files without labels in an excluded facet visible', () => {
    const excluded = emptyFacetExclusions();
    excluded.set('languages', new Set(['TypeScript']));

    expect(matchesFacets(labels, excluded)).toBe(true);
  });

  it('retains selected choices that are not currently observed', () => {
    const selected = emptyFacetExclusions();
    selected.set('groups', new Set(['Unavailable']));

    expect(facetChoices('groups', [labels], selected)).toEqual([
      'Tests',
      'Unavailable',
    ]);
  });

  it('sorts mapped languages before unmapped extensions and fallbacks', () => {
    const selected = emptyFacetExclusions();
    const choices: FileLabel[][] = [
      [
        { facet: 'languages', value: 'No extension' },
        { facet: 'languages', value: 'zsh' },
        { facet: 'languages', value: 'TypeScript' },
        { facet: 'languages', value: 'CSS' },
        { facet: 'languages', value: 'bash' },
        { facet: 'languages', value: 'yaml' },
        { facet: 'owners', value: 'Unmapped' },
        { facet: 'owners', value: '@zeta' },
        { facet: 'owners', value: '@Alpha' },
        { facet: 'owners', value: '@beta' },
        { facet: 'groups', value: 'No type' },
        { facet: 'groups', value: 'Tests' },
        { facet: 'groups', value: 'Code' },
      ],
    ];

    expect(facetChoices('languages', choices, selected)).toEqual([
      'CSS',
      'TypeScript',
      'bash',
      'yaml',
      'zsh',
      'No extension',
    ]);
    expect(facetChoices('owners', choices, selected)).toEqual([
      '@Alpha',
      '@beta',
      '@zeta',
      'Unmapped',
    ]);
    expect(facetChoices('groups', choices, selected)).toEqual([
      'Code',
      'Tests',
      'No type',
    ]);
  });
});
