import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import {
  type PageSnapshot,
  viewedControlState,
} from '@diffseek/github/review-page/page-adapter';
import { filterMenus } from '@diffseek/github/review-view/review-ui';
import {
  parseCodeowners,
  parseGitAttributes,
  type RepositoryMetadata,
} from '@diffseek/repository-metadata';
import {
  labelFiles,
  type FileRecord,
  type FilterState,
} from '@diffseek/review';

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

export function syncViewedLabels(files: FileRecord[]): void {
  for (const file of files) {
    const rest = file.labels.filter((label) => label.facet !== 'viewed');
    file.labels = file.viewed
      ? [{ facet: 'viewed', value: 'true' }, ...rest]
      : rest;
  }
}

export function projectionKeyFor(options: {
  metadataRevision: number;
  metadata: RepositoryMetadata;
  filters: FilterState;
  filterDefaults: FilterDefaults;
  generatedDefaultBusy: boolean;
  menuCount: number;
  files: readonly FileRecord[];
}): string {
  const filters = [...options.filters.entries()]
    .map(([facet, values]) => `${facet}:${[...values].sort().join(',')}`)
    .join('|');
  const defaults = [
    `hidden:${[...options.filterDefaults.hidden].sort().join(',')}`,
    `viewed:${[...options.filterDefaults.viewed].sort().join(',')}`,
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

export function refreshViewedState(
  snapshot: SupportedSnapshot,
  files: readonly FileRecord[],
): void {
  for (const file of files) {
    const control = snapshot.viewedControl(file.path);
    const viewed = control ? viewedControlState(control) : null;
    if (viewed != null) file.viewed = viewed;
  }
}

export function watchObservationRoots(options: {
  root: Document;
  observer: MutationObserver;
  observedRoots: Set<Element>;
}): void {
  let stale = false;
  for (const observed of options.observedRoots) {
    if (observed.isConnected) continue;
    options.observedRoots.delete(observed);
    stale = true;
  }
  if (stale) {
    options.observer.disconnect();
    options.observedRoots.clear();
  }
  const candidates: Element[] = [];
  const tree = options.root.querySelector(
    '[role="tree"][aria-label="File Tree"]',
  );
  if (tree) candidates.push(tree);
  for (const region of options.root.querySelectorAll(
    '[role="region"][id^="diff-"]',
  )) {
    candidates.push(region);
  }
  for (const menu of filterMenus(options.root)) candidates.push(menu);
  for (const candidate of candidates) {
    if (options.observedRoots.has(candidate)) continue;
    options.observer.observe(candidate, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-label',
        'aria-labelledby',
        'aria-pressed',
        'class',
      ],
    });
    options.observedRoots.add(candidate);
  }
}
