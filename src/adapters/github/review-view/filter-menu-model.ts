import type {
  FilterDefaults,
  FilterDefaultState,
  RememberedFilterFacet,
} from '@diffseek/browser/filter-defaults';
import {
  facetChoices,
  facetDefinitions,
  type FacetProjection,
  type FileRecord,
  type FilterState,
  isFallbackFacetValue,
  type LabelFacet,
  projectFacet,
} from '@diffseek/review';

const trueValue = 'true';
const unmappedOwner = 'Unmapped';
const ownerPrefixPattern = /^(@[^\/]+\/).+$/v;

export interface FilterMenuOptions {
  files: FileRecord[];
  filterDefaults?: FilterDefaults;
  filters: FilterState;
  generatedDefaultBusy?: boolean;
  onAlwaysReadChange?: (enabled: boolean) => void;
  onChange: () => void;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
  onViewed?: (viewed: boolean, paths: string[]) => void;
}

export interface MenuRowModel {
  counted: number;
  disabled?: boolean;
  excluded: Set<string>;
  facet: LabelFacet;
  filterDefaults?: FilterDefaults;
  label: string;
  onAlwaysReadChange?: (enabled: boolean) => void;
  onChange: () => void;
  onFilterDefaultChange?: (
    facet: RememberedFilterFacet,
    state: FilterDefaultState,
  ) => void;
  onlyValues?: string[];
  onViewed?: (viewed: boolean, paths: string[]) => void;
  paths: string[];
  total: number;
  value: string;
  viewedCount: number;
  visible: number;
}

export interface MenuSectionModel {
  heading?: string;
  rows: MenuRowModel[];
}

type FacetDefinition = (typeof facetDefinitions)[number];

export function menuRowModels(options: FilterMenuOptions): MenuSectionModel[] {
  const sections: MenuSectionModel[] = [{ rows: [viewedRow(options)] }];
  const generated = generatedRow(options);
  if (generated) sections.push({ rows: [generated] });
  const labelSets = options.files.map((file) => file.labels);
  for (const definition of dynamicFacets()) {
    const section = sectionFor(definition, options, labelSets);
    if (section) sections.push(section);
  }
  return sections;
}

function choiceRow(
  definition: FacetDefinition,
  options: FilterMenuOptions,
  details: {
    excluded: Set<string>;
    ownerPrefix: null | string;
    projections: Map<string, FacetProjection>;
    value: string;
    values: string[];
  },
): MenuRowModel {
  return {
    ...(details.projections.get(details.value) ?? emptyProjection()),
    excluded: details.excluded,
    facet: definition.facet,
    label: displayLabel(
      definition.label(details.value),
      details.value,
      definition.facet,
      details.ownerPrefix,
    ),
    onChange: options.onChange,
    ...(options.onViewed !== undefined && { onViewed: options.onViewed }),
    ...((details.values.length > 1) && { onlyValues: details.values }),
    value: details.value,
  };
}

function displayLabel(
  label: string,
  value: string,
  facet: LabelFacet,
  ownerPrefix: null | string,
): string {
  if (
    facet === 'owners' &&
    value !== unmappedOwner &&
    ownerPrefix !== null &&
    ownerPrefix !== '' &&
    label.startsWith(ownerPrefix)
  ) {
    return label.slice(ownerPrefix.length);
  }
  return label;
}

function dynamicFacets(): FacetDefinition[] {
  return facetDefinitions.filter(
    (entry) =>
      !entry.native && entry.facet !== 'generated' && entry.facet !== 'viewed',
  );
}

function emptyProjection(): FacetProjection {
  return {
    counted: 0,
    paths: [],
    total: 0,
    viewedCount: 0,
    viewedState: 'empty',
    visible: 0,
  };
}

function generatedRow(options: FilterMenuOptions): MenuRowModel | null {
  const generated = projectFacet(
    'generated',
    options.files,
    options.filters,
  ).get(trueValue);
  if (!generated || generated.total <= 0) return null;
  return rememberedRow(options, {
    disabled: options.generatedDefaultBusy === true,
    facet: 'generated',
    label: 'Generated files',
    projection: generated,
  });
}

function rememberedRow(
  options: FilterMenuOptions,
  details: {
    disabled?: boolean;
    facet: 'generated' | 'viewed';
    label: string;
    projection: FacetProjection;
  },
): MenuRowModel {
  return {
    ...details.projection,
    ...(details.disabled !== undefined && { disabled: details.disabled }),
    excluded: selection(options.filters, details.facet),
    facet: details.facet,
    label: details.label,
    ...(options.filterDefaults !== undefined && { filterDefaults: options.filterDefaults }),
    onChange: options.onChange,
    ...(options.onAlwaysReadChange !== undefined && { onAlwaysReadChange: options.onAlwaysReadChange }),
    ...(options.onFilterDefaultChange !== undefined && { onFilterDefaultChange: options.onFilterDefaultChange }),
    ...(options.onViewed !== undefined && { onViewed: options.onViewed }),
    value: trueValue,
  };
}

function sectionFor(
  definition: FacetDefinition,
  options: FilterMenuOptions,
  labelSets: FileRecord['labels'][],
): MenuSectionModel | null {
  const projections = projectFacet(
    definition.facet,
    options.files,
    options.filters,
  );
  const values = facetChoices(definition.facet, labelSets, options.filters);
  if (skipFacet(definition.facet, values)) return null;
  const ownerPrefix =
    definition.facet === 'owners' ? sharedOwnerPrefix(values) : null;
  const excluded = selection(options.filters, definition.facet);
  return {
    heading: definition.heading,
    rows: values.map((value) =>
      choiceRow(definition, options, {
        excluded,
        ownerPrefix,
        projections,
        value,
        values,
      }),
    ),
  };
}

function selection(filters: FilterState, facet: LabelFacet): Set<string> {
  const excluded = filters.get(facet);
  if (excluded) return excluded;
  const created = new Set<string>();
  filters.set(facet, created);
  return created;
}

function sharedOwnerPrefix(values: string[]): null | string {
  const mapped = values.filter((value) => value !== unmappedOwner);
  if (mapped.length <= 1) return null;
  const matches = mapped.map((value) => ownerPrefixPattern.exec(value));
  const prefix = matches[0]?.[1];
  if (prefix === undefined || prefix === '') return null;
  return matches.every((match) => match?.[1] === prefix) ? prefix : null;
}

function skipFacet(facet: LabelFacet, values: string[]): boolean {
  if (values.length === 0) return true;
  if (values.length !== 1) return false;
  return isFallbackFacetValue(facet, values[0] ?? '');
}

function viewedRow(options: FilterMenuOptions): MenuRowModel {
  const projection =
    projectFacet('viewed', options.files, options.filters).get(trueValue) ??
    emptyProjection();
  return rememberedRow(options, {
    facet: 'viewed',
    label: 'Viewed files',
    projection,
  });
}
