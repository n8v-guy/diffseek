import {
  labelFacets,
  type FileLabel,
  type LabelFacet,
} from '../classification/labels';

export type FacetExclusions = Map<LabelFacet, Set<string>>;

export type FacetDefinition = {
  facet: LabelFacet;
  heading: string;
  native: boolean;
  label: (value: string) => string;
};

export const facetDefinitions: FacetDefinition[] = [
  {
    facet: 'owners',
    heading: 'Owners',
    native: false,
    label: (value) => (value === 'Unmapped' ? 'No owner' : value),
  },
  { facet: 'groups', heading: 'Groups', native: false, label: identity },
  { facet: 'languages', heading: 'Formats', native: false, label: identity },
  {
    facet: 'viewed',
    heading: 'Viewed',
    native: false,
    label: (value) => (value === 'true' ? 'Viewed files' : 'Not viewed'),
  },
  {
    facet: 'statuses',
    heading: 'Change status',
    native: false,
    label: (value) => `${value[0]?.toUpperCase()}${value.slice(1)}`,
  },
  {
    facet: 'generated',
    heading: 'Generated',
    native: false,
    label: (value) => (value === 'true' ? 'Generated' : 'Not generated'),
  },
];

export function emptyFacetExclusions(): FacetExclusions {
  return new Map(labelFacets.map((facet) => [facet, new Set<string>()]));
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
      previous == null ? group : Math.min(previous, group),
    );
  }
  for (const value of excluded.get(facet) ?? []) {
    if (!sortGroup.has(value)) {
      sortGroup.set(value, isFallbackFacetValue(facet, value) ? 2 : 0);
    }
  }
  return [...sortGroup.keys()].sort((left, right) => {
    const leftGroup = sortGroup.get(left) ?? 0;
    const rightGroup = sortGroup.get(right) ?? 0;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    const foldedLeft = left.toLocaleLowerCase();
    const foldedRight = right.toLocaleLowerCase();
    return foldedLeft < foldedRight
      ? -1
      : foldedLeft > foldedRight
        ? 1
        : left < right
          ? -1
          : left > right
            ? 1
            : 0;
  });
}

function facetSortGroup(facet: LabelFacet, label: FileLabel): number {
  if (isFallbackFacetValue(facet, label.value)) return 2;
  if (facet === 'languages' && !label.mapped) return 1;
  return 0;
}

export function excludedFacetCount(excluded: FacetExclusions): number {
  return [...excluded.values()].reduce(
    (count, values) => count + values.size,
    0,
  );
}

function identity(value: string): string {
  return value;
}

export function isFallbackFacetValue(
  facet: LabelFacet,
  value: string,
): boolean {
  return (
    (facet === 'owners' && value === 'Unmapped') ||
    (facet === 'languages' && value === 'No extension') ||
    (facet === 'groups' && value === 'No type')
  );
}
