import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import {
  facetChoices,
  facetDefinitions,
  isFallbackFacetValue,
  type FileRecord,
  type FilterState,
  type LabelFacet,
  projectFacet,
} from '@diffseek/review';

export type FilterMenuOptions = {
  files: FileRecord[];
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  generatedDefaultBusy?: boolean;
  onChange: () => void;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
  onAlwaysReadChange?: (enabled: boolean) => void;
  onViewed?: (viewed: boolean, paths: string[]) => void;
};

export type MenuRowModel = {
  facet: LabelFacet;
  label: string;
  paths: string[];
  total: number;
  value: string;
  viewed: boolean;
  visible: number;
  hiddenViewedPaths: string[];
  excluded: Set<string>;
  onlyValues?: string[];
  filterDefaults?: FilterDefaults;
  disabled?: boolean;
  onChange: () => void;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
  onAlwaysReadChange?: (enabled: boolean) => void;
  onViewed?: (viewed: boolean, paths: string[]) => void;
};

export function menuRowModels(options: FilterMenuOptions): MenuRowModel[] {
  const labelSets = options.files.map((file) => file.labels);
  const rows: MenuRowModel[] = [
    {
      ...(projectFacet('viewed', options.files, options.filters).get('true') ??
        emptyProjection()),
      facet: 'viewed',
      label: 'Viewed files',
      value: 'true',
      excluded: selection(options.filters, 'viewed'),
      filterDefaults: options.filterDefaults,
      onChange: options.onChange,
      onFilterDefaultChange: options.onFilterDefaultChange,
      onAlwaysReadChange: options.onAlwaysReadChange,
      onViewed: options.onViewed,
    },
  ];
  const generated = projectFacet(
    'generated',
    options.files,
    options.filters,
  ).get('true');
  if (generated && generated.total > 0) {
    rows.push({
      ...generated,
      facet: 'generated',
      label: 'Generated files',
      value: 'true',
      excluded: selection(options.filters, 'generated'),
      filterDefaults: options.filterDefaults,
      disabled: options.generatedDefaultBusy === true,
      onChange: options.onChange,
      onFilterDefaultChange: options.onFilterDefaultChange,
      onAlwaysReadChange: options.onAlwaysReadChange,
      onViewed: options.onViewed,
    });
  }
  for (const definition of facetDefinitions.filter(
    (entry) =>
      !entry.native &&
      entry.facet !== 'generated' &&
      entry.facet !== 'viewed',
  )) {
    const projections = projectFacet(
      definition.facet,
      options.files,
      options.filters,
    );
    const values = facetChoices(definition.facet, labelSets, options.filters);
    if (
      values.length === 0 ||
      (values.length === 1 &&
        isFallbackFacetValue(definition.facet, values[0] ?? ''))
    ) {
      continue;
    }
    const ownerPrefix =
      definition.facet === 'owners' ? sharedOwnerPrefix(values) : null;
    const excluded = selection(options.filters, definition.facet);
    for (const value of values) {
      rows.push({
        ...(projections.get(value) ?? emptyProjection()),
        facet: definition.facet,
        label: displayLabel(
          definition.label(value),
          value,
          definition.facet,
          ownerPrefix,
        ),
        value,
        excluded,
        onlyValues: values.length > 1 ? values : undefined,
        onChange: options.onChange,
        onViewed: options.onViewed,
      });
    }
  }
  return rows;
}

export function selection(filters: FilterState, facet: LabelFacet): Set<string> {
  const excluded = filters.get(facet);
  if (excluded) return excluded;
  const created = new Set<string>();
  filters.set(facet, created);
  return created;
}

export function emptyProjection() {
  return {
    hiddenViewedPaths: [] as string[],
    paths: [] as string[],
    total: 0,
    viewed: false,
    visible: 0,
  };
}

export function sharedOwnerPrefix(values: string[]): string | null {
  const mapped = values.filter((value) => value !== 'Unmapped');
  if (mapped.length < 2) return null;
  const matches = mapped.map((value) => value.match(/^(@[^/]+\/).+$/));
  const prefix = matches[0]?.[1];
  return prefix && matches.every((match) => match?.[1] === prefix)
    ? prefix
    : null;
}

export function displayLabel(
  label: string,
  value: string,
  facet: LabelFacet,
  ownerPrefix: string | null,
): string {
  return facet === 'owners' &&
    value !== 'Unmapped' &&
    ownerPrefix &&
    label.startsWith(ownerPrefix)
    ? label.slice(ownerPrefix.length)
    : label;
}
