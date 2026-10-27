import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import {
  type PageSnapshot,
  viewedControlState,
} from '@diffseek/github/review-page/page-adapter';
import {
  filterMenus,
  isNativeMutation,
} from '@diffseek/github/review-view/review-ui';
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

export async function replaceReviewMetadata(options: {
  readPull: () => Promise<RepositoryMetadata>;
  refreshDefault: () => Promise<{
    metadata: RepositoryMetadata;
    changed: boolean;
  }>;
  commit: (metadata: RepositoryMetadata) => Promise<boolean>;
  aborted: () => boolean;
  apply: (metadata: RepositoryMetadata) => void;
}): Promise<void> {
  let pullApplied = false;
  await Promise.all([
    options
      .readPull()
      .then((metadata) => {
        pullApplied = true;
        if (!options.aborted()) options.apply(metadata);
      })
      .catch(() => undefined),
    options
      .refreshDefault()
      .then(async (result) => {
        if (options.aborted() || !result.changed) return;
        await options.commit(result.metadata).catch(() => false);
        if (!pullApplied && !options.aborted()) options.apply(result.metadata);
      })
      .catch(() => undefined),
  ]);
}

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
  for (const menu of filterMenus(options.root)) candidates.push(menu);
  // Prefer one region-container observer over N per-panel observers. Streaming
  // fixtures expose #diffseek-stream-host; otherwise use a non-body parent that
  // contains every diff region. Fall back to per-region only for small pages.
  const streamHost = options.root.querySelector('#diffseek-stream-host');
  if (streamHost) {
    candidates.push(streamHost);
  } else {
    const regions = [
      ...options.root.querySelectorAll('[role="region"][id^="diff-"]'),
    ];
    const sharedParent = sharedRegionParent(regions, options.root);
    if (sharedParent) {
      candidates.push(sharedParent);
    } else if (regions.length <= 40) {
      candidates.push(...regions);
    }
  }
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

function sharedRegionParent(
  regions: Element[],
  root: Document,
): Element | null {
  const first = regions[0];
  if (!first?.parentElement) return null;
  let parent: Element | null = first.parentElement;
  while (
    parent &&
    parent !== root.body &&
    parent !== root.documentElement &&
    !regions.every((region) => parent?.contains(region))
  ) {
    parent = parent.parentElement;
  }
  if (
    !parent ||
    parent === root.body ||
    parent === root.documentElement
  ) {
    return null;
  }
  return parent;
}

export type PanelScheduleOptions = {
  immediate?: boolean;
  coalesce?: boolean;
};

export type PanelReconcileSchedule = {
  timer: number | null;
  delayMs: number;
  scheduled: boolean;
};

export function discoverySchedule(
  records: MutationRecord[],
): PanelScheduleOptions | null {
  const native = records.filter(isNativeMutation);
  if (native.length === 0) return null;
  if (addedNodesMatch(native, '[role="menu"][aria-label="Filter options"]')) {
    return { immediate: true };
  }
  if (addedNodesMatch(native, '[role="region"][id^="diff-"]')) {
    return { coalesce: true };
  }
  return { immediate: true };
}

export function queuePanelReconcile(
  state: PanelReconcileSchedule,
  root: Document,
  options: PanelScheduleOptions,
  run: () => void,
): void {
  const view = root.defaultView;
  const delayMs =
    options.immediate || filterMenus(root).length > 0 || !options.coalesce
      ? 0
      : 64;
  // Never let a coalesced stream tick postpone an already-queued immediate flush.
  if (state.scheduled && state.delayMs === 0 && delayMs > 0) return;
  if (view && state.timer != null) view.clearTimeout(state.timer);
  state.scheduled = true;
  state.delayMs = delayMs;
  const fire = () => {
    state.scheduled = false;
    state.delayMs = 0;
    state.timer = null;
    run();
  };
  if (view) state.timer = view.setTimeout(fire, delayMs);
  else queueMicrotask(fire);
}

export function cancelPanelReconcile(
  state: PanelReconcileSchedule,
  view: Window | null,
): void {
  if (state.timer == null) return;
  view?.clearTimeout(state.timer);
  state.timer = null;
}

function addedNodesMatch(records: MutationRecord[], selector: string): boolean {
  return records.some(
    (record) =>
      record.type === 'childList' &&
      [...record.addedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(selector) || node.querySelector?.(selector) != null),
      ),
  );
}
