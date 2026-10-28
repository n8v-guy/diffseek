import type { FilterDefaults } from '@diffseek/browser/filter-defaults';
import {
  fileToggleAction,
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
    // Child list is watched from the document. Attribute noise here must not
    // schedule a reconcile unless it can change viewed, collapse, or file status.
    options.observer.observe(candidate, {
      subtree: true,
      attributes: true,
      attributeFilter: [
        ariaLabelAttribute,
        labelledByAttribute,
        'aria-pressed',
        'class',
      ],
    });
    options.observedRoots.add(candidate);
  }
  const filterButton = options.root.querySelector<HTMLElement>(
    'button[aria-label="Filter options"]',
  );
  if (filterButton && !options.observedRoots.has(filterButton)) {
    options.observer.observe(filterButton, {
      subtree: true,
      attributes: true,
      attributeFilter: [ariaLabelAttribute, 'aria-expanded', 'class'],
    });
    options.observedRoots.add(filterButton);
  }
}

/** A filtered-out file GitHub expanded again. Structure and labels stay put. */
export function filteredFileExpanded(root: Document): boolean {
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-diffseek-filtered-out="true"] button',
  )) {
    if (fileToggleAction(button) === 'Collapse file') return true;
  }
  return false;
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

const ariaLabelAttribute = 'aria-label';
const labelledByAttribute = 'aria-labelledby';

const controlLabels = new Set([
  'Viewed',
  'Not Viewed',
  'Collapse file',
  'Expand file',
]);

const structuralSelector = [
  '[role="tree"][aria-label="File Tree"]',
  '[role="treeitem"]',
  '[role="region"][id^="diff-"]',
  '[data-diff-header-wrapper="true"]',
  'button[aria-label="Viewed"]',
  'button[aria-label="Not Viewed"]',
  'button[aria-label="Collapse file"]',
  'button[aria-label="Expand file"]',
].join(',');

/**
 * Ignore diff-body churn (line nodes, highlight classes). Coalesce tree and
 * panel structure. Flush viewed/collapse aria and the filter menu immediately.
 */
export function scheduleForMutations(
  records: MutationRecord[],
): PanelScheduleOptions | null {
  const native = records.filter(isNativeMutation);
  if (native.length === 0) return null;
  if (native.some((record) => isImmediateRecord(record))) {
    return { immediate: true };
  }
  if (native.some((record) => isCoalescedRecord(record))) {
    return { coalesce: true };
  }
  return null;
}

export function pageNodesChanged(
  previousTree: Element | null,
  tree: Element | null,
  previousRegions: readonly Element[],
  regions: readonly Element[],
): boolean {
  return (
    previousTree !== tree ||
    previousRegions.length !== regions.length ||
    regions.some((region, index) => region !== previousRegions[index])
  );
}

export function queuePanelReconcile(
  state: PanelReconcileSchedule,
  root: Document,
  options: PanelScheduleOptions,
  run: () => void,
): void {
  const view = root.defaultView;
  const delayMs = options.immediate || !options.coalesce ? 0 : 64;
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

function isImmediateRecord(record: MutationRecord): boolean {
  if (isFilterMenuRecord(record) || isTreeContainerRecord(record)) return true;
  if (record.type !== 'attributes') return false;
  const name = record.attributeName;
  if (
    name !== ariaLabelAttribute &&
    name !== 'aria-pressed' &&
    name !== labelledByAttribute
  ) {
    return false;
  }
  const target = record.target;
  if (!(target instanceof Element)) return false;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return false;
  const label = button.getAttribute(ariaLabelAttribute) ?? '';
  return (
    controlLabels.has(label) ||
    button.closest('[data-diff-header-wrapper="true"]') != null
  );
}

function isCoalescedRecord(record: MutationRecord): boolean {
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      matchesStructural(node),
    );
  }
  if (record.type !== 'attributes' || record.attributeName !== 'class') {
    return false;
  }
  const target = record.target;
  if (!(target instanceof Element)) return false;
  if (
    target.closest('[role="tree"]') &&
    (target.matches('svg') || target.closest('svg') != null)
  ) {
    return true;
  }
  return (
    target.closest('button')?.closest('[data-diff-header-wrapper="true"]') !=
    null
  );
}

function isFilterMenuRecord(record: MutationRecord): boolean {
  if (record.type === 'attributes') {
    const target = record.target;
    if (!(target instanceof Element)) return false;
    return isFilterMenuElement(target) || isFilterOptionsButton(target);
  }
  if (isFilterMenuElement(record.target)) return true;
  return [...record.addedNodes, ...record.removedNodes].some((node) =>
    containsFilterMenu(node),
  );
}

function isFilterOptionsButton(target: Element): boolean {
  const button =
    target instanceof HTMLButtonElement ? target : target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return false;
  if (button.getAttribute(ariaLabelAttribute) === 'Filter options') return true;
  const labelledBy = button.getAttribute(labelledByAttribute);
  if (!labelledBy) return false;
  return labelledBy.split(/\s+/).some(
    (id) =>
      button.ownerDocument.getElementById(id)?.textContent === 'Filter options',
  );
}

function containsFilterMenu(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (isFilterMenuElement(node) || node.matches('[role="menu"]')) return true;
  // Diff panels are large. Only small overlays can be an unlabelled menu shell.
  if (node.childElementCount > 8) return false;
  return node.querySelector('[role="menu"]') != null;
}

function isTreeContainerRecord(record: MutationRecord): boolean {
  if (record.type !== 'childList') return false;
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) =>
      node instanceof Element &&
      node.matches('[role="tree"][aria-label="File Tree"]'),
  );
}

function isFilterMenuElement(node: Node): boolean {
  return (
    node instanceof Element &&
    node.getAttribute('role') === 'menu' &&
    (node.getAttribute(ariaLabelAttribute) === 'Filter options' ||
      node.hasAttribute(labelledByAttribute))
  );
}

function matchesStructural(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(structuralSelector) ||
      node.querySelector(structuralSelector) != null)
  );
}
