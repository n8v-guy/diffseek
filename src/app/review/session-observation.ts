import {
  afterCurrentTask,
  filterMenus,
  isNativeMutation,
} from '@diffseek/github/review-view/review-ui';

export interface PageNodes {
  regions: readonly Element[];
  tree: Element | null;
}

export interface PanelReconcileSchedule {
  /** Cancels the queued pass; null when nothing is queued. */
  cancel: (() => void) | null;
  /** The queued pass runs as the next task rather than at the next frame. */
  immediate: boolean;
  readonly root: Document;
  readonly run: () => void;
}

export interface PanelScheduleOptions {
  coalesce?: boolean;
  immediate?: boolean;
}

export function freshPanelSchedule(
  root: Document,
  run: () => void,
): PanelReconcileSchedule {
  return { cancel: null, immediate: false, root, run };
}

export function watchObservationRoots(options: ObservationRoots): void {
  dropDisconnected(options);
  for (const candidate of observationCandidates(options.root)) {
    observeAttributes(options, candidate, contentAttributeFilter);
  }
  const filterButton = options.root.querySelector<HTMLElement>(filterButtonSelector);
  if (filterButton === null || options.observedRoots.has(filterButton)) return;
  observeAttributes(options, filterButton, filterButtonAttributeFilter);
}

function dropDisconnected(options: ObservationRoots): void {
  let stale = false;
  for (const observed of options.observedRoots) {
    if (observed.isConnected) continue;
    options.observedRoots.delete(observed);
    stale = true;
  }
  if (!stale) return;
  options.observer.disconnect();
  options.observedRoots.clear();
}

function isDocumentBoundary(parent: Element, root: Document): boolean {
  const boundaries: Element[] = [root.body, root.documentElement];
  return boundaries.includes(parent);
}

function observationCandidates(root: Document): Element[] {
  const candidates: Element[] = [];
  const tree = root.querySelector(fileTreeSelector);
  if (tree !== null) candidates.push(tree);
  for (const menu of filterMenus(root)) candidates.push(menu);
  candidates.push(...regionCandidates(root));
  return candidates;
}

function observeAttributes(
  options: ObservationRoots,
  target: Element,
  attributeFilter: string[],
): void {
  if (options.observedRoots.has(target)) return;
  // Child list is watched from the document. Attribute noise here must not
  // schedule a reconcile unless it can change viewed, collapse, or file status.
  options.observer.observe(target, {
    attributeFilter,
    attributes: true,
    subtree: true,
  });
  options.observedRoots.add(target);
}

function parentNeedsClimb(
  parent: Element | null,
  regions: Element[],
  root: Document,
): boolean {
  if (parent === null || isDocumentBoundary(parent, root)) return false;
  const current = parent;
  return regions.some((region) => !current.contains(region));
}

function regionCandidates(root: Document): Element[] {
  // Prefer one region-container observer over N per-panel observers. Streaming
  // fixtures expose #diffseek-stream-host; otherwise use a non-body parent that
  // contains every diff region. Fall back to per-region only for small pages.
  const streamHost = root.querySelector('#diffseek-stream-host');
  if (streamHost !== null) return [streamHost];
  const regions = [...root.querySelectorAll(diffRegionSelector)];
  const sharedParent = sharedRegionParent(regions, root);
  if (sharedParent !== null) return [sharedParent];
  if (regions.length <= perRegionObserverLimit) return regions;
  return [];
}

function sharedRegionParent(
  regions: Element[],
  root: Document,
): Element | null {
  const first = regions[0];
  if (first === undefined || first.parentElement === null) return null;
  let parent: Element | null = first.parentElement;
  while (parent !== null && parentNeedsClimb(parent, regions, root)) {
    parent = parent.parentElement;
  }
  if (parent === null || isDocumentBoundary(parent, root)) return null;
  return parent;
}

const ariaExpandedAttribute = 'aria-expanded';
const ariaLabelAttribute = 'aria-label';
const ariaPressedAttribute = 'aria-pressed';
const classAttribute = 'class';
export const collapseFileLabel = 'Collapse file';
const diffHeaderSelector = '[data-diff-header-wrapper="true"]';
const diffRegionSelector = '[role="region"][id^="diff-"]';
const expandFileLabel = 'Expand file';
const fileTreeSelector = '[role="tree"][aria-label="File Tree"]';
const filterButtonSelector = 'button[aria-label="Filter options"]';
const filterOptionsLabel = 'Filter options';
const labelledByAttribute = 'aria-labelledby';
const menuRole = 'menu';
const menuRoleSelector = '[role="menu"]';
const menuShellChildLimit = 8;
const notViewedLabel = 'Not Viewed';
const perRegionObserverLimit = 40;
const viewedLabel = 'Viewed';

const contentAttributeFilter = [
  ariaLabelAttribute,
  labelledByAttribute,
  ariaPressedAttribute,
  classAttribute,
];
const filterButtonAttributeFilter = [
  ariaLabelAttribute,
  ariaExpandedAttribute,
  classAttribute,
];

const controlLabels = new Set([
  collapseFileLabel,
  expandFileLabel,
  notViewedLabel,
  viewedLabel,
]);

const structuralSelector = [
  fileTreeSelector,
  '[role="treeitem"]',
  diffRegionSelector,
  diffHeaderSelector,
  `button[${ariaLabelAttribute}="${viewedLabel}"]`,
  `button[${ariaLabelAttribute}="${notViewedLabel}"]`,
  `button[${ariaLabelAttribute}="${collapseFileLabel}"]`,
  `button[${ariaLabelAttribute}="${expandFileLabel}"]`,
].join(',');

interface ObservationRoots {
  observedRoots: Set<Element>;
  observer: MutationObserver;
  root: Document;
}

export function cancelPanelReconcile(state: PanelReconcileSchedule): void {
  state.cancel?.();
  state.cancel = null;
  state.immediate = false;
}

export function pageNodesChanged(previous: PageNodes, next: PageNodes): boolean {
  return (
    previous.tree !== next.tree ||
    previous.regions.length !== next.regions.length ||
    next.regions.some((region, index) => region !== previous.regions[index])
  );
}

/**
 * Immediate passes run as the next task. Coalesced passes (streamed tree and
 * panel structure) run once at the next animation frame, so a burst of
 * mutations inside one frame costs one pass and lands before that frame
 * paints. No timers: the browser's frame is the batching event.
 */
export function queuePanelReconcile(
  state: PanelReconcileSchedule,
  options: PanelScheduleOptions,
): void {
  const immediate = options.immediate === true || options.coalesce !== true;
  // A queued pass that runs at least as soon already covers this request.
  if (state.cancel && (state.immediate || !immediate)) return;
  state.cancel?.();
  state.immediate = immediate;
  const fire = (): void => {
    state.cancel = null;
    state.immediate = false;
    state.run();
  };
  const view = state.root.defaultView;
  if (immediate || view === null) {
    state.cancel = afterCurrentTask(fire);
    return;
  }
  const frame = view.requestAnimationFrame(fire);
  state.cancel = (): void => {
    view.cancelAnimationFrame(frame);
  };
}

/**
 * Ignore diff-body churn (line nodes, highlight classes). Coalesce tree and
 * panel structure. Flush viewed/collapse aria and the filter menu immediately.
 */
export function scheduleForMutations(
  records: MutationRecord[],
): null | PanelScheduleOptions {
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

function containsFilterMenu(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (isFilterMenuElement(node) || node.matches(menuRoleSelector)) return true;
  // Diff panels are large. Only small overlays can be an unlabelled menu shell.
  if (node.childElementCount > menuShellChildLimit) return false;
  return node.querySelector(menuRoleSelector) !== null;
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
    (target.matches('svg') || target.closest('svg') !== null)
  ) {
    return true;
  }
  const button = target.closest('button');
  if (button === null) return false;
  return button.closest(diffHeaderSelector) !== null;
}

function isControlAttribute(name: null | string): boolean {
  return (
    name === ariaLabelAttribute ||
    name === ariaPressedAttribute ||
    name === labelledByAttribute
  );
}

function isControlAttributeRecord(record: MutationRecord): boolean {
  if (record.type !== 'attributes' || !isControlAttribute(record.attributeName)) {
    return false;
  }
  const target = record.target;
  if (!(target instanceof Element)) return false;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return false;
  const label = button.getAttribute(ariaLabelAttribute) ?? '';
  return controlLabels.has(label) || button.closest(diffHeaderSelector) !== null;
}

function isFilterMenuElement(node: Node): boolean {
  return (
    node instanceof Element &&
    node.getAttribute('role') === menuRole &&
    (node.getAttribute(ariaLabelAttribute) === filterOptionsLabel ||
      node.hasAttribute(labelledByAttribute))
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
  if (button.getAttribute(ariaLabelAttribute) === filterOptionsLabel) return true;
  const labelledBy = button.getAttribute(labelledByAttribute);
  if (labelledBy === null || labelledBy === '') return false;
  return labelledBy.split(/\s+/v).some(
    (id) =>
      button.ownerDocument.getElementById(id)?.textContent === filterOptionsLabel,
  );
}

function isImmediateRecord(record: MutationRecord): boolean {
  return (
    isFilterMenuRecord(record) ||
    isTreeContainerRecord(record) ||
    isControlAttributeRecord(record)
  );
}

function isTreeContainerRecord(record: MutationRecord): boolean {
  if (record.type !== 'childList') return false;
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) =>
      node instanceof Element &&
      node.matches(fileTreeSelector),
  );
}

function matchesStructural(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(structuralSelector) ||
      node.querySelector(structuralSelector) !== null)
  );
}
