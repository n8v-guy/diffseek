import {
  type FileLabel,
  type LabelFacet,
  labelFacets,
} from '../classification/label';

import type { FacetExclusions } from './exclusions';

export type { FacetExclusions } from './exclusions';

const extensionSortGroup = 1;
const fallbackSortGroup = 2;

export interface FacetDefinition {
  facet: LabelFacet;
  heading: string;
  label: (value: string) => string;
  native: boolean;
}

export const facetDefinitions: FacetDefinition[] = [
  {
    facet: 'owners',
    heading: 'Owners',
    label: (value) => (value === 'Unmapped' ? 'No owner' : value),
    native: false,
  },
  { facet: 'groups', heading: 'Groups', label: identity, native: false },
  { facet: 'languages', heading: 'Formats', label: identity, native: false },
  {
    facet: 'viewed',
    heading: 'Viewed',
    label: (value) => (value === 'true' ? 'Viewed files' : 'Not viewed'),
    native: false,
  },
  {
    facet: 'statuses',
    heading: 'Change status',
    label: (value) => `${value[0]?.toUpperCase()}${value.slice(1)}`,
    native: false,
  },
  {
    facet: 'generated',
    heading: 'Generated',
    label: (value) => (value === 'true' ? 'Generated' : 'Not generated'),
    native: false,
  },
];

export function emptyFacetExclusions(): FacetExclusions {
  return new Map(labelFacets.map((facet) => [facet, new Set<string>()]));
}

export function excludedFacetCount(excluded: FacetExclusions): number {
  return excluded.values().reduce(
    (count, values) => count + values.size,
    0,
  );
}

export function facetChoices(
  facet: LabelFacet,
  labelSets: FileLabel[][],
  excluded: FacetExclusions,
): string[] {
  const sortGroup = new Map<string, number>();
  for (const label of labelSets.flat()) {
    if (label.facet !== facet) continue;
    const group = facetSortGroup(facet, label);
    const previous = sortGroup.get(label.value);
    sortGroup.set(
      label.value,
      previous === undefined ? group : Math.min(previous, group),
    );
  }
  for (const value of excluded.get(facet) ?? []) {
    if (!sortGroup.has(value)) {
      sortGroup.set(
        value,
        isFallbackFacetValue(facet, value) ? fallbackSortGroup : 0,
      );
    }
  }
  return sortGroup.keys().toArray().toSorted((left, right) => {
    const byGroup = (sortGroup.get(left) ?? 0) - (sortGroup.get(right) ?? 0);
    return (
      byGroup ||
      textOrder(left.toLocaleLowerCase(), right.toLocaleLowerCase()) ||
      textOrder(left, right)
    );
  });
}

export function isFallbackFacetValue(
  facet: LabelFacet,
  value: string,
): boolean {
  return (
    (facet === 'owners' && value === 'Unmapped') ||
    (facet === 'languages' && value === 'No extension') ||
    (facet === 'groups' && value === 'No groups')
  );
}

export function matchesFacets(
  labels: FileLabel[],
  excluded: FacetExclusions,
): boolean {
  for (const [facet, values] of excluded) {
    if (values.size === 0) continue;
    const matching = labels.filter((label) => label.facet === facet);
    if (matching.length > 0 && matching.every((label) => values.has(label.value))) {
      return false;
    }
  }
  return true;
}

function facetSortGroup(facet: LabelFacet, label: FileLabel): number {
  if (isFallbackFacetValue(facet, label.value)) return fallbackSortGroup;
  if (facet === 'languages' && label.fromLinguistLanguage !== true) {
    return extensionSortGroup;
  }
  return 0;
}

function identity(value: string): string {
  return value;
}

function textOrder(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
