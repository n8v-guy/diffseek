import type { ChangeStatus, FileRecord } from '@diffseek/review';
import { extensionOf } from '@diffseek/review';

export const diffHeaderSelector = '[data-diff-header-wrapper="true"]';
export const diffRegionSelector = '[role="region"][id^="diff-"]';
export const fileTreeSelector = '[role="tree"][aria-label="File Tree"]';
export const fileTreeItemSelector = '[role="treeitem"]';
const ariaLabelAttribute = 'aria-label';
const headerButtonSelector = `${diffHeaderSelector} button`;
const generatedNotice = 'Some generated files are not rendered by default';
/** The docs link in GitHub's "Load Diff" placeholder for a generated file. */
export const generatedNoticeLinkSelector =
  'a[href*="customizing-how-changed-files-appear-on-github"]';

export function fileTreeElement(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(fileTreeSelector);
}

export function diffRegionElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(diffRegionSelector)];
}

export type PageSnapshot =
  | {
      supported: true;
      files: FileRecord[];
      unavailable: Map<string, string>;
      filterableRegion: (file: FileRecord) => boolean;
      tree: () => HTMLElement | null;
      treeItems: () => HTMLElement[];
      treeItem: (path: string) => HTMLElement | null;
      region: (path: string) => HTMLElement | null;
      viewedControl: (path: string) => HTMLButtonElement | null;
    }
  | {
      supported: false;
      reason: string;
    };

/** Tree membership + per-row href/status. Region hydration must not invalidate this. */
export function treeStructureKey(root: Document): string | null {
  const tree = fileTreeElement(root);
  if (!tree) return null;
  return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')]
    .map((item) => {
      const href =
        item.querySelector<HTMLAnchorElement>('a[href^="#diff-"]')?.getAttribute(
          'href',
        ) ?? '';
      return `${item.id}\0${href}\0${changeStatusOf(item) ?? ''}`;
    })
    .join('\n');
}

export function regionStructureKey(root: Document): string {
  return diffRegionElements(root)
    .map((region) => `${region.id}\0${displayedPathOf(region) ?? ''}`)
    .join('\n');
}

export function pageStructureKey(root: Document): string | null {
  const treeKey = treeStructureKey(root);
  if (treeKey == null) return null;
  return `${treeKey}\n--\n${regionStructureKey(root)}`;
}

export function scanPage(root: Document): PageSnapshot {
  const tree = fileTreeElement(root);
  if (!tree) return { supported: false, reason: 'No file tree on this page' };

  const files: FileRecord[] = [];
  const unavailable = new Map<string, string>();
  const regions = indexRegions(root);
  const regionsById = regions.byId;

  for (const treeItem of tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')) {
    const link = [...treeItem.querySelectorAll<HTMLAnchorElement>('a[href^="#diff-"]')].find(
      (candidate) => candidate.closest('[role="treeitem"]') === treeItem,
    );
    if (!link) continue;

    const anchor = link.getAttribute('href')?.slice(1) ?? '';
    if (!isDiffAnchor(anchor)) {
      unavailable.set(treeItem.id, 'Invalid diff anchor');
      continue;
    }

    const matches = regionsById.get(anchor) ?? [];
    const region = matches.length === 1 ? matches[0] : undefined;

    const status = changeStatusOf(treeItem);
    if (!status) {
      unavailable.set(treeItem.id, 'Incomplete diff structure');
      continue;
    }

    if (region == null || region.getAttribute('role') !== 'region') {
      files.push({
        path: treeItem.id,
        anchor,
        extension: extensionOf(treeItem.id),
        owners: [],
        generated: false,
        status,
        viewed: false,
        capabilities: { collapse: false, viewed: false },
        labels: [],
      });
      continue;
    }

    const viewedButton = [
      ...region.querySelectorAll<HTMLButtonElement>(headerButtonSelector),
    ].find((button) => viewedControlState(button) != null);
    const collapseButton = [
      ...region.querySelectorAll<HTMLButtonElement>(headerButtonSelector),
    ].find((button) => fileToggleAction(button) != null);
    files.push({
      path: treeItem.id,
      anchor,
      extension: extensionOf(treeItem.id),
      owners: ownersOf(region),
      generated: false,
      ...(hasGeneratedNotice(region) ? { generatedOnPage: true } : {}),
      status,
      viewed: viewedButton ? viewedControlState(viewedButton) === true : false,
      capabilities: {
        collapse: collapseButton != null,
        viewed: viewedButton != null,
      },
      labels: [],
    });
  }

  return bindSnapshot(root, files, unavailable, regions);
}

export function refreshObservedFiles(
  root: Document,
  files: readonly FileRecord[],
): void {
  const { byId } = indexRegions(root);
  for (const file of files) {
    const matches = byId.get(file.anchor) ?? [];
    if (matches.length !== 1) continue;
    const region = matches[0];
    if (!region || region.getAttribute('role') !== 'region') continue;
    const viewedButton = [
      ...region.querySelectorAll<HTMLButtonElement>(headerButtonSelector),
    ].find((button) => viewedControlState(button) != null);
    const collapseButton = [
      ...region.querySelectorAll<HTMLButtonElement>(headerButtonSelector),
    ].find((button) => fileToggleAction(button) != null);
    const owners = ownersOf(region);
    if (owners.length > 0) file.owners = owners;
    if (file.generatedOnPage !== true && hasGeneratedNotice(region)) {
      file.generatedOnPage = true;
    }
    file.viewed = viewedButton
      ? viewedControlState(viewedButton) === true
      : file.viewed;
    file.capabilities = {
      collapse: collapseButton != null,
      viewed: viewedButton != null,
    };
  }
}

/**
 * GitHub's "Load Diff" placeholder for a generated file: the notice with its
 * docs link, beside the Load Diff button. Quoted text elsewhere does not count.
 */
function hasGeneratedNotice(region: HTMLElement): boolean {
  const notice = region.querySelector(generatedNoticeLinkSelector)?.parentElement;
  if (notice == null || notice.closest(diffHeaderSelector) != null) return false;
  return (
    notice.textContent.trim().startsWith(generatedNotice) &&
    [...(notice.parentElement?.children ?? [])].some(
      (sibling) => sibling instanceof HTMLButtonElement && sibling.textContent.trim() === 'Load Diff',
    )
  );
}

export function bindSnapshot(
  root: Document,
  files: FileRecord[],
  unavailable: Map<string, string>,
  regions = indexRegions(root),
): Extract<PageSnapshot, { supported: true }> {
  const treeItem = (path: string) => {
    const item = root.getElementById(path);
    return item?.getAttribute('role') === 'treeitem' &&
      item.closest(fileTreeSelector)
      ? item
      : null;
  };
  const region = (path: string) => {
    const anchor = files.find((file) => file.path === path)?.anchor;
    const matches =
      (anchor ? regions.byId.get(anchor) : regions.byPath.get(path)) ?? [];
    if (matches.length !== 1) return null;
    const element = matches[0];
    return element?.getAttribute('role') === 'region' ? element : null;
  };
  const viewedControl = (path: string) => {
    const fileRegion = region(path);
    return fileRegion
      ? [...fileRegion.querySelectorAll<HTMLButtonElement>(
          headerButtonSelector,
        )].find((button) => viewedControlState(button) != null) ?? null
      : null;
  };
  return {
    supported: true,
    files,
    unavailable,
    filterableRegion: ({ anchor, path }) => {
      const matches = regions.byId.get(anchor);
      if (!matches) return false;
      if (matches.length === 1) return true;
      // GitHub streams a "Loading <path>" region beside the file with the same id.
      const loading = `Loading ${path}`;
      return matches.filter((node) => node.getAttribute(ariaLabelAttribute) !== loading)
        .length === 1;
    },
    tree: () => fileTreeElement(root),
    treeItems: () => [
      ...root.querySelectorAll<HTMLElement>(
        `${fileTreeSelector} [role="treeitem"][id]`,
      ),
    ],
    treeItem,
    region,
    viewedControl,
  };
}

function displayedPathOf(region: HTMLElement): string | undefined {
  return region
    .querySelector('h3 code')
    ?.textContent.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
}

function indexRegions(root: Document): {
  byId: Map<string, HTMLElement[]>;
  byPath: Map<string, HTMLElement[]>;
} {
  const byId = new Map<string, HTMLElement[]>();
  const byPath = new Map<string, HTMLElement[]>();
  for (const region of diffRegionElements(root)) {
    const idMatches = byId.get(region.id) ?? [];
    idMatches.push(region);
    byId.set(region.id, idMatches);
    const path = displayedPathOf(region);
    if (!path) continue;
    const pathMatches = byPath.get(path) ?? [];
    pathMatches.push(region);
    byPath.set(path, pathMatches);
  }
  return { byId, byPath };
}

function isDiffAnchor(value: string): value is `diff-${string}` {
  return value.startsWith('diff-') && value.length > 'diff-'.length;
}

function changeStatusOf(treeItem: HTMLElement): ChangeStatus | null {
  const icon = treeItem.querySelector('svg');
  if (icon?.classList.contains('octicon-file-added')) return 'added';
  if (icon?.classList.contains('octicon-file-removed')) return 'deleted';
  if (icon?.classList.contains('octicon-file-moved')) return 'renamed';
  if (icon?.classList.contains('octicon-file-diff')) return 'modified';
  return null;
}

function ownersOf(region: HTMLElement): string[] {
  const tooltip = [...region.querySelectorAll<HTMLElement>('[role="tooltip"]')]
    .map((element) => element.getAttribute(ariaLabelAttribute) ?? element.textContent)
    .find((text) => text.trim().startsWith('Owned by'));

  return [...new Set(tooltip?.match(/@[\w-]+(?:\/[\w-]+)?/g) ?? [])];
}

function fileToggleAction(
  button: HTMLButtonElement,
): 'Collapse file' | 'Expand file' | null {
  const name = controlName(button);
  if (name === 'Collapse file' || name === 'Expand file') return name;
  if (button.querySelector('svg.octicon-chevron-down')) return 'Collapse file';
  if (button.querySelector('svg.octicon-chevron-right')) return 'Expand file';
  return null;
}

export function viewedControlState(
  button: HTMLButtonElement,
): boolean | null {
  const name = controlName(button);
  const pressed = button.getAttribute('aria-pressed');
  if (name === 'Viewed' && pressed === 'true') return true;
  if (name === 'Not Viewed' && pressed === 'false') return false;
  return null;
}

function controlName(button: HTMLButtonElement): string | null {
  return (
    button.getAttribute(ariaLabelAttribute) ||
    button
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => button.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim() ||
    null
  );
}
