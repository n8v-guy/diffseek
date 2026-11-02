import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser';
import {
  facetChoices,
  facetDefinitions,
  isFallbackFacetValue,
  type FileRecord,
  type FilterState,
  type LabelFacet,
  projectFacet,
} from '@diffseek/review';

type MenuActions = {
  onChange: () => void;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
  onAlwaysReadChange?: (enabled: boolean) => void;
  onViewed?: (viewed: boolean, paths: string[]) => void;
};

export type FilterMenuOptions = MenuActions & {
  files: FileRecord[];
  filters: FilterState;
  filterDefaults?: FilterDefaults;
  generatedDefaultBusy?: boolean;
};

export type MenuRowModel = MenuActions & {
  facet: LabelFacet;
  label: string;
  paths: string[];
  total: number;
  value: string;
  counted: number;
  viewedCount: number;
  visible: number;
  excluded: Set<string>;
  onlyValues?: string[];
  filterDefaults?: FilterDefaults;
  disabled?: boolean;
};

export type MenuSectionModel = {
  heading?: string;
  rows: MenuRowModel[];
};

export function menuRowModels(options: FilterMenuOptions): MenuSectionModel[] {
  const labelSets = options.files.map((file) => file.labels);
  const sections: MenuSectionModel[] = [
    {
      rows: [
        {
          ...(projectFacet('viewed', options.files, options.filters).get(
            'true',
          ) ?? emptyProjection()),
          facet: 'viewed',
          label: 'Viewed files',
          value: 'true',
          excluded: selection(options.filters, 'viewed'),
          ...sharedRowFields(options),
        },
      ],
    },
  ];
  const generated = projectFacet(
    'generated',
    options.files,
    options.filters,
  ).get('true');
  if (generated && generated.total > 0) {
    sections.push({
      rows: [
        {
          ...generated,
          facet: 'generated',
          label: 'Generated files',
          value: 'true',
          excluded: selection(options.filters, 'generated'),
          disabled: options.generatedDefaultBusy === true,
          ...sharedRowFields(options),
        },
      ],
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
    const rows: MenuRowModel[] = [];
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
        ...(values.length > 1 ? { onlyValues: values } : {}),
        onChange: options.onChange,
        ...(options.onViewed !== undefined ? { onViewed: options.onViewed } : {}),
      });
    }
    sections.push({ heading: definition.heading, rows });
  }
  return sections;
}

function sharedRowFields(options: FilterMenuOptions): MenuActions & {
  filterDefaults?: FilterDefaults;
} {
  return {
    onChange: options.onChange,
    ...(options.filterDefaults !== undefined
      ? { filterDefaults: options.filterDefaults }
      : {}),
    ...(options.onFilterDefaultChange !== undefined
      ? { onFilterDefaultChange: options.onFilterDefaultChange }
      : {}),
    ...(options.onAlwaysReadChange !== undefined
      ? { onAlwaysReadChange: options.onAlwaysReadChange }
      : {}),
    ...(options.onViewed !== undefined ? { onViewed: options.onViewed } : {}),
  };
}

function selection(filters: FilterState, facet: LabelFacet): Set<string> {
  const excluded = filters.get(facet);
  if (excluded) return excluded;
  const created = new Set<string>();
  filters.set(facet, created);
  return created;
}

function emptyProjection() {
  return {
    counted: 0,
    paths: [] as string[],
    total: 0,
    viewedCount: 0,
    viewedState: 'empty' as const,
    visible: 0,
  };
}

function sharedOwnerPrefix(values: string[]): string | null {
  const mapped = values.filter((value) => value !== 'Unmapped');
  if (mapped.length < 2) return null;
  const matches = mapped.map((value) => value.match(/^(@[^/]+\/).+$/));
  const prefix = matches[0]?.[1];
  return prefix && matches.every((match) => match?.[1] === prefix)
    ? prefix
    : null;
}

function displayLabel(
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
