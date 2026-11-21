import {
  filterMenus,
  filterOptionsButton,
  filterOptionsLabel,
  isFilterOptionsTrigger,
  isNativeMutation,
} from '../review-view/review-ui';

import {
  diffHeaderSelector,
  diffRegionElements,
  diffRegionSelector,
  fileTreeElement,
  fileTreeItemSelector,
  fileTreeSelector,
  generatedNoticeLinkSelector,
} from './page-adapter';

const ariaLabelAttribute = 'aria-label';
const labelledByAttribute = 'aria-labelledby';
/** Above this many diff regions, watch one shared parent instead of each panel. */
const perRegionObserverLimit = 40;
/** Diff panels are large. Only small overlays can be an unlabelled menu shell. */
const overlayChildLimit = 8;

const controlLabels = new Set([
  'Viewed',
  'Not Viewed',
  'Collapse file',
  'Expand file',
]);

const structuralSelector = [
  fileTreeSelector,
  fileTreeItemSelector,
  diffRegionSelector,
  diffHeaderSelector,
  'button[aria-label="Viewed"]',
  'button[aria-label="Not Viewed"]',
  'button[aria-label="Collapse file"]',
  'button[aria-label="Expand file"]',
  generatedNoticeLinkSelector,
].join(',');

/**
 * Ignore diff-body churn (line nodes, highlight classes). Coalesce tree and
 * panel structure. Flush viewed/collapse aria and the filter menu immediately.
 */
export function classifyPageMutations(
  records: MutationRecord[],
): { immediate: true } | { coalesce: true } | null {
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

export function watchObservationRoots(options: {
  root: Document;
  observer: MutationObserver;
  observedRoots: Set<Element>;
}): void {
  if ([...options.observedRoots].some((observed) => !observed.isConnected)) {
    options.observer.disconnect();
    options.observedRoots.clear();
  }
  const candidates: Element[] = [];
  const tree = fileTreeElement(options.root);
  if (tree) candidates.push(tree);
  for (const menu of filterMenus(options.root)) candidates.push(menu);
  // Observe a shared region container when possible. Watching every
  // region individually is only practical on smaller pages.
  const regions = diffRegionElements(options.root);
  const sharedParent = sharedRegionParent(regions, options.root);
  if (sharedParent) {
    candidates.push(sharedParent);
  } else if (regions.length <= perRegionObserverLimit) {
    candidates.push(...regions);
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
  const filterButton = filterOptionsButton(options.root);
  if (filterButton && !options.observedRoots.has(filterButton)) {
    options.observer.observe(filterButton, {
      subtree: true,
      attributes: true,
      attributeFilter: [ariaLabelAttribute, labelledByAttribute, 'aria-expanded', 'class', 'style'],
    });
    options.observedRoots.add(filterButton);
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

export function collectReviewNodeIds(
  node: Node,
  kind: 'tree' | 'panel',
  into: Set<string>,
): void {
  if (!(node instanceof Element)) return;
  // The filter menu is not a file tree. Walking it on every open showed up as
  // longer long tasks and cannot be a tree or diff-panel rebuild.
  const role = node.getAttribute('role');
  if (role === 'menu' || role === 'menuitem' || role === 'menuitemcheckbox') return;
  const selector = kind === 'tree' ? fileTreeItemSelector : diffRegionSelector;
  const rows = [
    ...(node.matches(selector) ? [node] : []),
    ...node.querySelectorAll<HTMLElement>(selector),
  ];
  for (const row of rows) into.add(row.id);
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
    button.closest(diffHeaderSelector) != null
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
    target.closest('button')?.closest(diffHeaderSelector) !=
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
  return button instanceof HTMLButtonElement && isFilterOptionsTrigger(button);
}

function containsFilterMenu(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (isFilterMenuElement(node) || node.matches('[role="menu"]')) return true;
  // GitHub swaps its server-rendered filter button for the interactive one.
  if (node instanceof HTMLButtonElement) return isFilterOptionsButton(node);
  // Diff panels are large. Only small overlays can be an unlabelled menu shell.
  if (node.childElementCount > overlayChildLimit) return false;
  return (
    node.querySelector('[role="menu"]') != null ||
    [...node.querySelectorAll('button[aria-haspopup]')].some(isFilterOptionsButton)
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

function isFilterMenuElement(node: Node): boolean {
  return (
    node instanceof Element &&
    node.getAttribute('role') === 'menu' &&
    (node.getAttribute(ariaLabelAttribute) === filterOptionsLabel ||
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
