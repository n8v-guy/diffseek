import type { FileLabel } from '../classification/label';
import type { FileRecord, FilterState } from '../model/file';

export type ViewInputs = {
  files: readonly FileRecord[];
  filters: FilterState;
  filterDefaults: {
    hidden: ReadonlySet<string>;
    viewed: ReadonlySet<string>;
  };
  generatedDefaultBusy: boolean;
};

/**
 * What each surface shows, as comparable values. `page` covers the tree rows,
 * diff panels, and viewed circles; `menu` covers everything the filter menu
 * shows, which includes `page`.
 */
export type ViewPlan = {
  readonly page: string;
  readonly menu: string;
};

export type ViewChange = { page: boolean; menu: boolean };

const pageFields = ['path', 'labels', 'viewed', 'capabilities'] as const satisfies readonly (keyof FileRecord)[];

/** Pure: the same inputs always give the same plan, and inputs are only read. */
export function planView(inputs: ViewInputs): ViewPlan {
  const filters = [...inputs.filters.entries()]
    .map(([facet, values]) => `${facet}:${sortedList(values)}`)
    .join('|');
  const files = inputs.files.map(projectFile);
  const page = [filters, ...files.map((file) => pageFields.map((field) => file[field]).join('\0'))];
  const menu = [
    ...page,
    `hidden:${sortedList(inputs.filterDefaults.hidden)}`,
    `viewed:${sortedList(inputs.filterDefaults.viewed)}`,
    flag(inputs.generatedDefaultBusy),
    ...files.map((file) => Object.values(file).join('\0')),
  ];
  return { page: page.join('\n'), menu: menu.join('\n') };
}

/** A surface needs writing only when its plan differs from the applied one. */
export function changedSurfaces(
  applied: ViewPlan | null,
  next: ViewPlan,
): ViewChange {
  return { page: applied?.page !== next.page, menu: applied?.menu !== next.menu };
}

function sortedList(values: ReadonlySet<string>): string {
  return [...values].sort((left, right) => left.localeCompare(right)).join(',');
}

/** A new FileRecord or FileLabel field left out of these maps is a type error. */
function projectFile(file: FileRecord): Record<keyof FileRecord, string> {
  const capabilities = {
    collapse: flag(file.capabilities.collapse),
    viewed: flag(file.capabilities.viewed),
  } satisfies Record<keyof FileRecord['capabilities'], string>;
  return {
    anchor: file.anchor,
    capabilities: Object.values(capabilities).join('\0'),
    extension: file.extension ?? '',
    generated: flag(file.generated),
    labels: file.labels.map(projectLabel).join(','),
    owners: file.owners.join(','),
    path: file.path,
    status: file.status,
    viewed: flag(file.viewed),
  };
}

function projectLabel(label: FileLabel): string {
  const parts = {
    facet: label.facet,
    fromLinguistLanguage: flag(label.fromLinguistLanguage ?? false),
    value: label.value,
  } satisfies Record<keyof FileLabel, string>;
  return Object.values(parts).join('=');
}

function flag(value: boolean): string {
  return value ? '1' : '0';
}
