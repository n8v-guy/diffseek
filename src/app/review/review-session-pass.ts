import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import type { ReviewPresenter } from '@diffseek/github/review-view/presenter';

import {
  type PageSnapshot,
  viewedControlState,
} from '@diffseek/github/review-page/page-adapter';
import {
  mountViewedActions,
  type ViewedTarget,
} from '@diffseek/github/review-page/viewed-actions';
import {
  parseCodeowners,
  parseGitAttributes,
  type RepositoryMetadata,
} from '@diffseek/repository-metadata';
import {
  type FileRecord,
  type FilterState,
  labelFiles,
  ReviewIndex,
} from '@diffseek/review';

import type { ViewedActionExecutor } from './action-executor';

export interface ProjectionPass {
  changed: boolean;
  defaultViewedPaths: string[];
  fingerprint: string;
  generatedDefaultBusy: boolean;
  menus: HTMLElement[];
  staleMenus: HTMLElement[];
}

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export function classifyKeyFor(
  metadata: RepositoryMetadata,
  files: readonly FileRecord[],
): string {
  return [
    metadata.codeowners,
    metadata.attributes,
    files
      .map((file) => `${file.path}\0${file.status}\0${file.owners.join(',')}`)
      .join('\n'),
  ].join('\n--\n');
}

export function classifySnapshot(
  snapshot: SupportedSnapshot,
  metadata: RepositoryMetadata,
): void {
  labelFiles(snapshot.files, {
    attributes: parseGitAttributes(metadata.attributes),
    codeowners: metadata.codeowners
      ? parseCodeowners(metadata.codeowners)
      : [],
  });
}

export async function enqueueDefaultViewed(
  enqueue: ViewedActionExecutor['enqueue'],
  command: Parameters<ViewedActionExecutor['enqueue']>[0],
): Promise<Awaited<ReturnType<ViewedActionExecutor['enqueue']>>> {
  try {
    return await enqueue(command);
  } catch {
    return null;
  }
}

export function pendingDefaultViewed(
  files: readonly FileRecord[],
  defaults: FilterDefaults,
  attempts: ReadonlySet<string>,
): string[] {
  if (!defaults.viewed.has('generated')) return [];
  return files
    .filter(
      (file) =>
        file.generated &&
        !file.viewed &&
        file.capabilities.viewed &&
        !attempts.has(file.path),
    )
    .map((file) => file.path);
}

export function projectionKeyFor(options: {
  files: readonly FileRecord[];
  filterDefaults: FilterDefaults;
  filters: FilterState;
  generatedDefaultBusy: boolean;
  menuCount: number;
  metadata: RepositoryMetadata;
  metadataRevision: number;
}): string {
  const filters = [...options.filters]
    .map(([facet, values]) => `${facet}:${sortedText(values)}`)
    .join('|');
  const defaults = [
    `hidden:${sortedText(options.filterDefaults.hidden)}`,
    `viewed:${sortedText(options.filterDefaults.viewed)}`,
  ].join('/');
  const files = options.files
    .map((file) =>
      [
        file.path,
        file.viewed ? '1' : '0',
        file.capabilities.viewed ? '1' : '0',
        file.capabilities.collapse ? '1' : '0',
        file.status,
        file.owners.join(','),
        file.generated ? '1' : '0',
        file.labels.map((label) => `${label.facet}=${label.value}`).join(','),
      ].join('\0'),
    )
    .join('\n');
  return [
    options.metadataRevision,
    options.metadata.codeowners,
    options.metadata.attributes,
    filters,
    defaults,
    options.generatedDefaultBusy ? '1' : '0',
    String(options.menuCount),
    files,
  ].join('\n--\n');
}

export function refreshViewedState(
  snapshot: SupportedSnapshot,
  files: readonly FileRecord[],
): void {
  for (const file of files) {
    const control = snapshot.viewedControl(file.path);
    if (control === null) continue;
    const viewed = viewedControlState(control);
    if (viewed !== null) file.viewed = viewed;
  }
}

export function retainNativeOwners(
  snapshot: SupportedSnapshot,
  observedOwners: Map<string, string[]>,
): void {
  for (const file of snapshot.files) {
    if (file.owners.length > 0) {
      observedOwners.set(file.path, file.owners);
    } else {
      file.owners = observedOwners.get(file.path) ?? [];
    }
  }
}

export function syncViewedLabels(files: FileRecord[]): void {
  for (const file of files) {
    const rest = file.labels.filter((label) => label.facet !== 'viewed');
    file.labels = file.viewed
      ? [{ facet: 'viewed', value: 'true' }, ...rest]
      : rest;
  }
}

export function viewedPathFromClick(
  event: MouseEvent,
  view: Document['defaultView'],
  snapshot: null | SupportedSnapshot,
): string | undefined {
  if (!event.isTrusted || view === null) return undefined;
  const target = event.target;
  if (!(target instanceof view.Element)) return undefined;
  const button = target.closest('button');
  if (!(button instanceof view.HTMLButtonElement)) return undefined;
  return snapshot?.files.find(
    (file) => snapshot.viewedControl(file.path) === button,
  )?.path;
}

export function writeSessionProjection(input: {
  batch: (target: ViewedTarget, viewed: boolean, paths: string[]) => void;
  catalogSnapshot: SupportedSnapshot;
  enqueueDefault: (paths: string[]) => void;
  filters: FilterState;
  mount: (
    menu: HTMLElement,
    snapshot: SupportedSnapshot,
    generatedDefaultBusy: boolean,
  ) => void;
  presenter: ReviewPresenter;
  projection: ProjectionPass;
  setFingerprint: (fingerprint: string) => void;
  structureChanged: boolean;
}): void {
  const { projection } = input;
  if (input.structureChanged || projection.changed) {
    const index = new ReviewIndex(input.catalogSnapshot.files);
    input.presenter.apply(input.catalogSnapshot, input.filters, index);
    mountViewedActions(
      input.catalogSnapshot,
      (target, viewed, paths): void => {
        input.batch(target, viewed, paths);
      },
      { filters: input.filters, index },
    );
  }
  if (projection.changed) {
    input.setFingerprint(projection.fingerprint);
    if (projection.defaultViewedPaths.length > 0) {
      input.enqueueDefault(projection.defaultViewedPaths);
    }
  }
  const menus = projection.changed ? projection.menus : projection.staleMenus;
  for (const menu of menus) {
    input.mount(menu, input.catalogSnapshot, projection.generatedDefaultBusy);
  }
}

function sortedText(values: ReadonlySet<string>): string {
  return [...values]
    .toSorted((left, right) => left.localeCompare(right))
    .join(',');
}
