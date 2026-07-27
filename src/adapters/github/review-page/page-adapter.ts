import type { ChangeStatus, FileRecord } from '@diffseek/review';
import { extensionOf } from '@diffseek/review';

const headerButtonSelector = '[data-diff-header-wrapper="true"] button';

export type PageSnapshot =
  | {
      supported: true;
      files: FileRecord[];
      unavailable: Map<string, string>;
      tree: () => HTMLElement | null;
      treeItems: () => HTMLElement[];
      treeItem: (path: string) => HTMLElement | null;
      region: (path: string) => HTMLElement | null;
      viewedControl: (path: string) => HTMLButtonElement | null;
      collapseControl: (path: string) => HTMLButtonElement | null;
    }
  | {
      supported: false;
      reason: string;
    };

export function scanPage(root: Document): PageSnapshot {
  const tree = root.querySelector<HTMLElement>(
    '[role="tree"][aria-label="File Tree"]',
  );
  if (!tree) return { supported: false, reason: 'File tree is unavailable' };

  const files: FileRecord[] = [];
  const unavailable = new Map<string, string>();
  const { byId: regionsById, byPath: regionsByPath } = indexRegions(root);

  for (const treeItem of tree.querySelectorAll<HTMLElement>('[role="treeitem"][id]')) {
    const link = treeItem.querySelector<HTMLAnchorElement>('a[href^="#diff-"]');
    if (!link) continue;

    const anchor = link.getAttribute('href')?.slice(1) ?? '';
    if (!isDiffAnchor(anchor)) {
      unavailable.set(treeItem.id, 'Invalid diff anchor');
      continue;
    }

    const regions = regionsById.get(anchor) ?? [];
    if (regions.length > 1) {
      unavailable.set(treeItem.id, 'Duplicate diff region');
      continue;
    }
    const region = regions[0];
    const displayedPath = region ? displayedPathOf(region) : undefined;
    if (displayedPath?.startsWith(`${treeItem.id}/`)) continue;

    const status = changeStatusOf(treeItem);
    const viewedButton = region
      ? [...region.querySelectorAll<HTMLButtonElement>(
          headerButtonSelector,
        )].find((button) => viewedControlState(button) != null)
      : undefined;
    const collapseButton = region
      ? [...region.querySelectorAll<HTMLButtonElement>(
          headerButtonSelector,
        )].find((button) => fileToggleAction(button) != null)
      : undefined;

    if (
      !region ||
      region.getAttribute('role') !== 'region' ||
      !status ||
      displayedPath !== treeItem.id
    ) {
      unavailable.set(treeItem.id, 'Incomplete diff structure');
      continue;
    }

    const file: FileRecord = {
      path: treeItem.id,
      anchor,
      extension: extensionOf(treeItem.id),
      owners: ownersOf(region),
      generated: false,
      status,
      viewed: viewedButton ? viewedControlState(viewedButton) === true : false,
      capabilities: {
        collapse: collapseButton != null,
        viewed: viewedButton != null,
      },
      labels: [],
    };
    files.push(file);
  }

  const treeItem = (path: string) => {
    const item = root.getElementById(path);
    return item?.getAttribute('role') === 'treeitem' &&
      item.closest('[role="tree"][aria-label="File Tree"]')
      ? item
      : null;
  };
  const region = (path: string) => {
    const matches = regionsByPath.get(path) ?? [];
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
  const collapseControl = (path: string) => {
    const fileRegion = region(path);
    return fileRegion
      ? [...fileRegion.querySelectorAll<HTMLButtonElement>(
          headerButtonSelector,
        )].find((button) => fileToggleAction(button) != null) ?? null
      : null;
  };

  return {
    supported: true,
    files,
    unavailable,
    tree: () =>
      root.querySelector<HTMLElement>(
        '[role="tree"][aria-label="File Tree"]',
      ),
    treeItems: () => [
      ...root.querySelectorAll<HTMLElement>(
        '[role="tree"][aria-label="File Tree"] [role="treeitem"][id]',
      ),
    ],
    treeItem,
    region,
    viewedControl,
    collapseControl,
  };
}

function displayedPathOf(region: HTMLElement): string | undefined {
  return region
    .querySelector('h3 code')
    ?.textContent?.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
}

function indexRegions(root: Document): {
  byId: Map<string, HTMLElement[]>;
  byPath: Map<string, HTMLElement[]>;
} {
  const byId = new Map<string, HTMLElement[]>();
  const byPath = new Map<string, HTMLElement[]>();
  for (const region of root.querySelectorAll<HTMLElement>(
    '[role="region"][id^="diff-"]',
  )) {
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
  return value.startsWith('diff-') && value.length > 5;
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
    .map((element) => element.getAttribute('aria-label') ?? element.textContent ?? '')
    .find((text) => text.trim().startsWith('Owned by'));

  return [...new Set(tooltip?.match(/@[\w-]+(?:\/[\w-]+)?/g) ?? [])];
}

export function fileToggleAction(
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
    button.getAttribute('aria-label') ||
    button
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => button.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim() ||
    null
  );
}
