import { facetDefinitions } from '@diffseek/review';

import {
  applyCheckedState,
  cycleFilterDefault,
} from './filter-default-state';
import {
  itemKey,
  moveFocus,
} from './filter-menu-keyboard';
import {
  type FilterMenuOptions,
  type MenuRowModel,
  menuRowModels,
} from './filter-menu-model';
import {
  filtersRootSelector,
  patchFilterMenu,
  syncMenuItemDisabled,
} from './filter-menu-patch';
import {
  hasTransientExclusions,
  resetTransientExclusions,
} from './filter-reset';
import {
  alwaysReadAction,
  itemOnlyAction,
  sectionAllAction,
} from './filter-shortcuts';
import {
  menuViewedCounter,
  menuViewedOverlay,
} from './menu-viewed-action';
import { showHideNow } from './review-ui';

export type { FilterMenuOptions } from './filter-menu-model';

export function mountFilterMenu(
  menu: HTMLElement,
  options: FilterMenuOptions,
): void {
  if (
    menu.dataset.diffseekMenuOwned === 'true' &&
    patchFilterMenu(menu, options)
  ) {
    return;
  }
  const focused = focusedItem(menu);
  menu.querySelector(filtersRootSelector)?.remove();
  if (clearNativeFilters(menu)) return;
  takeOverMenu(menu);

  const root = document.createElement('li');
  root.dataset.diffseek = 'filters';
  root.setAttribute('role', 'none');
  const content = document.createElement('div');
  content.className = 'diffseek-menu-content';
  root.append(content);

  const sections: MenuRowModel[][] = [];
  for (const row of menuRowModels(options)) {
    if (row.facet === 'viewed' || row.facet === 'generated') {
      appendItem(content, row);
      continue;
    }
    const current = sections.at(-1);
    if (current?.[0]?.facet === row.facet) current.push(row);
    else sections.push([row]);
  }
  if (sections.length > 0) appendSeparator(content);
  for (const [index, rows] of sections.entries()) {
    appendSection(content, rows);
    if (index < sections.length - 1) appendSeparator(content);
  }
  if (hasTransientExclusions(options.filters, options.filterDefaults)) {
    appendResetFilters(root, options);
  }

  root.addEventListener('keydown', moveFocus);
  menu.append(root);
  if (focused) {
    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => itemKey(button) === focused)
      ?.focus();
  }
}

function appendSection(root: HTMLElement, rows: MenuRowModel[]): void {
  const first = rows[0];
  const heading = facetDefinitions.find(
    (definition) => definition.facet === first?.facet,
  )?.heading;
  if (!first || heading == null) return;
  const section = document.createElement('section');
  section.className = 'diffseek-menu-section';
  const titleRow = document.createElement('div');
  titleRow.className = 'diffseek-menu-section-title';
  const title = document.createElement('h3');
  title.textContent = heading;
  titleRow.append(title);
  if (first.excluded.size > 0) {
    titleRow.append(
      sectionAllAction({
        excluded: first.excluded,
        heading,
        onChange: first.onChange,
      }),
    );
  }
  section.append(titleRow);
  for (const row of rows) appendItem(section, row);
  root.append(section);
}

function appendItem(root: HTMLElement, options: MenuRowModel): void {
  const row = document.createElement('div');
  row.className = 'diffseek-menu-row';
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'diffseek-menu-item';
  item.setAttribute('role', 'menuitemcheckbox');
  item.dataset.filterKind = options.facet;
  item.dataset.filterValue = options.value;
  applyCheckedState(item, options);
  syncMenuItemDisabled(item, options.disabled === true);
  const text = document.createElement('span');
  text.textContent = options.label;
  item.append(text);
  item.addEventListener('click', () => {
    if (item.disabled) return;
    if (cycleFilterDefault(options)) {
      applyCheckedState(item, options);
      if (item.getAttribute('aria-checked') === 'false') {
        showHideNow(item.ownerDocument);
      }
      options.onChange();
      return;
    }
    if (options.excluded.has(options.value)) {
      options.excluded.delete(options.value);
    } else {
      options.excluded.add(options.value);
    }
    item.setAttribute(
      'aria-checked',
      String(!options.excluded.has(options.value)),
    );
    options.onChange();
  });
  row.append(item);
  const defaults = options.filterDefaults;
  if (options.facet === 'generated' && defaults) {
    row.append(
      alwaysReadAction({
        enabled: defaults.viewed.has('generated'),
        disabled: options.disabled === true,
        onToggle: (enabled) => {
          if (enabled) defaults.viewed.add('generated');
          else defaults.viewed.delete('generated');
          options.onAlwaysReadChange?.(enabled);
          options.onChange();
        },
      }),
    );
  }
  if (options.onlyValues) {
    row.append(
      itemOnlyAction({
        excluded: options.excluded,
        label: options.label,
        onChange: options.onChange,
        value: options.value,
        values: options.onlyValues,
      }),
    );
  }
  const onViewed = options.onViewed;
  if (options.paths.length > 0 && onViewed) {
    const actionOptions = {
      counted: options.counted,
      disabled: options.disabled === true,
      facet: options.facet,
      onViewed,
      paths: options.paths,
      total: options.total,
      value: options.value,
      viewedCount: options.viewedCount,
      visible: options.visible,
    };
    row.append(menuViewedCounter(actionOptions));
    row.append(menuViewedOverlay(actionOptions));
  } else {
    const counter = document.createElement('span');
    counter.className = 'diffseek-menu-count';
    counter.textContent = `${options.visible}/${options.total}`;
    row.append(counter);
  }
  root.append(row);
}

function appendSeparator(root: HTMLElement): void {
  const separator = document.createElement('div');
  separator.dataset.diffseekSeparator = 'true';
  separator.setAttribute('role', 'separator');
  root.append(separator);
}

function appendResetFilters(
  root: HTMLElement,
  options: Pick<
    FilterMenuOptions,
    'filters' | 'onChange' | 'filterDefaults'
  >,
): void {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'diffseek-reset-filters';
  reset.dataset.resetFilters = 'true';
  reset.setAttribute('aria-label', 'Reset filters');
  reset.setAttribute('role', 'menuitem');
  reset.title = 'Reset filters';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.dataset.diffseekResetIcon = 'true';
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 3v4h4M3.4 6.4A5 5 0 1 1 3 10');
  icon.append(path);
  reset.append(icon);
  reset.addEventListener('click', () => {
    resetTransientExclusions(options.filters, options.filterDefaults);
    options.onChange();
  });
  root.append(reset);
}

function focusedItem(menu: HTMLElement): string | null {
  const active = menu.ownerDocument.activeElement;
  return active instanceof HTMLButtonElement &&
    active.closest(filtersRootSelector)
    ? itemKey(active)
    : null;
}

function clearNativeFilters(menu: HTMLElement): boolean {
  const clear = [...menu.querySelectorAll<HTMLElement>('button, [role="menuitem"]')]
    .find(
      (item) =>
        !item.closest(filtersRootSelector) &&
        item.textContent?.trim() === 'Clear filters',
    );
  if (!clear) {
    delete menu.dataset.diffseekNativeClearing;
    return false;
  }
  if (!menu.dataset.diffseekNativeClearing) {
    menu.dataset.diffseekNativeClearing = 'true';
    clear.click();
  }
  return true;
}

function takeOverMenu(menu: HTMLElement): void {
  menu.dataset.diffseekMenuOwned = 'true';
  for (const child of [...menu.children]) {
    if (
      child instanceof HTMLElement &&
      child.dataset.diffseek !== 'filters' &&
      !child.hidden
    ) {
      child.dataset.diffseekNativeHidden = 'true';
      child.hidden = true;
    }
  }
}
