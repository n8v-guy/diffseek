import {
  type ChangeStatus,
  extensionOf,
  type FileRecord,
} from '@diffseek/review';

const ariaLabel = 'aria-label';
const ariaPressed = 'aria-pressed';
const bidirectionalMarks = /[\u{200E}\u{200F}\u{202A}-\u{202E}]/gv;
const collapseFile = 'Collapse file';
const diffAnchorSelector = 'a[href^="#diff-"]';
const diffPrefix = 'diff-';
const expandFile = 'Expand file';
const fileTreeSelector = '[role="tree"][aria-label="File Tree"]';
const headerButtonSelector = '[data-diff-header-wrapper="true"] button';
const incompleteDiff = 'Incomplete diff structure';
const invalidAnchor = 'Invalid diff anchor';
const ownerMention = /@[\w\-]+(?:\/[\w\-]+)?/gv;
const regionRole = 'region';
const regionSelector = '[role="region"][id^="diff-"]';
const treeItemRole = 'treeitem';
const treeItemSelector = '[role="treeitem"][id]';

export type PageSnapshot =
  | {
      collapseControl: (path: string) => HTMLButtonElement | null;
      files: FileRecord[];
      region: (path: string) => HTMLElement | null;
      supported: true;
      tree: () => HTMLElement | null;
      treeItem: (path: string) => HTMLElement | null;
      treeItems: () => HTMLElement[];
      unavailable: Map<string, string>;
      viewedControl: (path: string) => HTMLButtonElement | null;
    }
  | {
      reason: string;
      supported: false;
    };

type PageFiles = Pick<SupportedSnapshot, 'files' | 'unavailable'>;
type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export function bindSnapshot(
  root: Document,
  { files, unavailable }: PageFiles,
  regions = indexRegions(root),
): SupportedSnapshot {
  const region = (path: string): HTMLElement | null =>
    regionForPath(files, regions, path);
  return {
    collapseControl: (path: string): HTMLButtonElement | null =>
      headerControl(region(path), (button) => fileToggleAction(button) !== null),
    files,
    region,
    supported: true,
    tree: (): HTMLElement | null =>
      root.querySelector<HTMLElement>(fileTreeSelector),
    treeItem: (path: string): HTMLElement | null => treeItemFor(root, path),
    treeItems: (): HTMLElement[] => [
      ...root.querySelectorAll<HTMLElement>(
        `${fileTreeSelector} ${treeItemSelector}`,
      ),
    ],
    unavailable,
    viewedControl: (path: string): HTMLButtonElement | null =>
      headerControl(region(path), (button) => viewedControlState(button) !== null),
  };
}

export function fileToggleAction(
  button: HTMLButtonElement,
): 'Collapse file' | 'Expand file' | null {
  const name = controlName(button);
  if (name === collapseFile || name === expandFile) return name;
  if (button.querySelector('svg.octicon-chevron-down')) return collapseFile;
  if (button.querySelector('svg.octicon-chevron-right')) return expandFile;
  return null;
}

export function fileTreeElement(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(fileTreeSelector);
}

export function pageStructureKey(root: Document): null | string {
  const treeKey = treeStructureKey(root);
  if (treeKey === null) return null;
  return `${treeKey}\n--\n${regionStructureKey(root)}`;
}

export function refreshObservedFiles(
  root: Document,
  files: readonly FileRecord[],
): void {
  const { byId } = indexRegions(root);
  for (const file of files) refreshFile(byId, file);
}

export function regionStructureKey(root: Document): string {
  return [...root.querySelectorAll<HTMLElement>(regionSelector)]
    .map((region) => `${region.id}\0${displayedPathOf(region) ?? ''}`)
    .join('\n');
}

export function scanPage(root: Document): PageSnapshot {
  const tree = root.querySelector<HTMLElement>(fileTreeSelector);
  if (!tree) return { reason: 'No file tree on this page', supported: false };
  const page: PageFiles = { files: [], unavailable: new Map() };
  const regions = indexRegions(root);
  for (const treeItem of tree.querySelectorAll<HTMLElement>(treeItemSelector)) {
    readTreeItem(treeItem, regions.byId, page);
  }
  return bindSnapshot(root, page, regions);
}

/** Tree membership + per-row href/status. Region hydration must not invalidate this. */
export function treeStructureKey(root: Document): null | string {
  const tree = root.querySelector<HTMLElement>(fileTreeSelector);
  if (!tree) return null;
  return [...tree.querySelectorAll<HTMLElement>(treeItemSelector)]
    .map((item) => treeItemKey(item))
    .join('\n');
}

export function viewedControlState(button: HTMLButtonElement): boolean | null {
  const name = controlName(button);
  const pressed = button.getAttribute(ariaPressed);
  if (name === 'Viewed' && pressed === 'true') return true;
  if (name === 'Not Viewed' && pressed === 'false') return false;
  return null;
}

function changeStatusOf(treeItem: HTMLElement): ChangeStatus | null {
  const icon = treeItem.querySelector('svg');
  if (!icon) return null;
  if (icon.classList.contains('octicon-file-added')) return 'added';
  if (icon.classList.contains('octicon-file-removed')) return 'deleted';
  if (icon.classList.contains('octicon-file-moved')) return 'renamed';
  if (icon.classList.contains('octicon-file-diff')) return 'modified';
  return null;
}

function controlName(button: HTMLButtonElement): null | string {
  const label = button.getAttribute(ariaLabel);
  if (label !== null && label !== '') return label;
  const labelledBy = button.getAttribute('aria-labelledby');
  if (labelledBy === null || labelledBy === '') return null;
  const text = labelledBy
    .split(/\s+/v)
    .map((id) => button.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
  return text === '' ? null : text;
}

function displayedPathOf(region: HTMLElement): string | undefined {
  const text = region.querySelector('h3 code')?.textContent;
  if (text === undefined) return undefined;
  return text.replaceAll(bidirectionalMarks, '');
}

function headerButton(
  region: HTMLElement,
  match: (button: HTMLButtonElement) => boolean,
): HTMLButtonElement | undefined {
  return [...region.querySelectorAll<HTMLButtonElement>(headerButtonSelector)].find(
    (button) => match(button),
  );
}

function headerControl(
  region: HTMLElement | null,
  match: (button: HTMLButtonElement) => boolean,
): HTMLButtonElement | null {
  if (!region) return null;
  return headerButton(region, match) ?? null;
}

function indexRegions(root: Document): {
  byId: Map<string, HTMLElement[]>;
  byPath: Map<string, HTMLElement[]>;
} {
  const byId = new Map<string, HTMLElement[]>();
  const byPath = new Map<string, HTMLElement[]>();
  for (const region of root.querySelectorAll<HTMLElement>(regionSelector)) {
    const idMatches = byId.get(region.id) ?? [];
    idMatches.push(region);
    byId.set(region.id, idMatches);
    const path = displayedPathOf(region);
    if (path === undefined || path === '') continue;
    const pathMatches = byPath.get(path) ?? [];
    pathMatches.push(region);
    byPath.set(path, pathMatches);
  }
  return { byId, byPath };
}

function isDiffAnchor(value: string): value is `diff-${string}` {
  return value.startsWith(diffPrefix) && value.length > diffPrefix.length;
}

function isReviewRegion(
  element: HTMLElement | undefined,
): element is HTMLElement {
  return element?.getAttribute('role') === regionRole;
}

function ownersOf(region: HTMLElement): string[] {
  const tooltip = [...region.querySelectorAll<HTMLElement>('[role="tooltip"]')]
    .map((element) => tooltipText(element))
    .find((text) => text.trimStart().startsWith('Owned by'));
  if (tooltip === undefined) return [];
  return [...new Set(tooltip.match(ownerMention))];
}

function readTreeItem(
  treeItem: HTMLElement,
  regionsById: Map<string, HTMLElement[]>,
  { files, unavailable }: PageFiles,
): void {
  const link = [...treeItem.querySelectorAll<HTMLAnchorElement>(diffAnchorSelector)].find(
    (candidate) =>
      candidate.closest(`[role="${CSS.escape(treeItemRole)}"]`) === treeItem,
  );
  if (!link) return;
  const anchor = link.getAttribute('href')?.slice(1) ?? '';
  if (!isDiffAnchor(anchor)) {
    unavailable.set(treeItem.id, invalidAnchor);
    return;
  }
  const status = changeStatusOf(treeItem);
  if (!status) {
    unavailable.set(treeItem.id, incompleteDiff);
    return;
  }
  const file: FileRecord = {
    anchor,
    capabilities: { collapse: false, viewed: false },
    extension: extensionOf(treeItem.id),
    generated: false,
    labels: [],
    owners: [],
    path: treeItem.id,
    status,
    viewed: false,
  };
  refreshFile(regionsById, file);
  files.push(file);
}

function refreshFile(
  byId: Map<string, HTMLElement[]>,
  file: FileRecord,
): void {
  const matches = byId.get(file.anchor) ?? [];
  if (matches.length !== 1) return;
  const region = matches[0];
  if (!isReviewRegion(region)) return;
  const viewedButton = headerButton(
    region,
    (button) => viewedControlState(button) !== null,
  );
  const collapseButton = headerButton(
    region,
    (button) => fileToggleAction(button) !== null,
  );
  const owners = ownersOf(region);
  if (owners.length > 0) file.owners = owners;
  if (viewedButton !== undefined) {
    file.viewed = viewedControlState(viewedButton) === true;
  }
  file.capabilities = {
    collapse: collapseButton !== undefined,
    viewed: viewedButton !== undefined,
  };
}

function regionForPath(
  files: readonly FileRecord[],
  regions: ReturnType<typeof indexRegions>,
  path: string,
): HTMLElement | null {
  const anchor = files.find((file) => file.path === path)?.anchor;
  const matches =
    anchor === undefined
      ? regions.byPath.get(path) ?? []
      : regions.byId.get(anchor) ?? [];
  if (matches.length !== 1) return null;
  const element = matches[0];
  if (element?.getAttribute('role') === regionRole) return element;
  return null;
}

function tooltipText(element: HTMLElement): string {
  return element.getAttribute(ariaLabel) ?? element.textContent;
}

function treeItemFor(root: Document, path: string): HTMLElement | null {
  const item = root.getElementById(path);
  if (
    item?.getAttribute('role') === treeItemRole &&
    item.closest(fileTreeSelector)
  ) {
    return item;
  }
  return null;
}

function treeItemKey(item: HTMLElement): string {
  const href =
    item
      .querySelector<HTMLAnchorElement>(diffAnchorSelector)
      ?.getAttribute('href') ?? '';
  return `${item.id}\0${href}\0${changeStatusOf(item) ?? ''}`;
}
