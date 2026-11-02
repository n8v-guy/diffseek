import { applyCheckedState, cycleFilterDefault } from './filter-default-state';
import { itemKey, moveFocus } from './filter-menu-keyboard';
import { type FilterMenuOptions, type MenuRowModel, menuRowModels } from './filter-menu-model';
import { filtersRootSelector, patchFilterMenu, syncMenuItemDisabled } from './filter-menu-patch';
import { hasTransientExclusions, resetTransientExclusions } from './filter-reset';
import { alwaysReadAction, itemOnlyAction, sectionAllAction } from './filter-shortcuts';
import { menuViewedCounter, menuViewedOverlay } from './menu-viewed-action';
import { showHideNow } from './review-ui';

const ariaChecked = 'aria-checked';
const clearFiltersLabel = 'Clear filters';
const menuCountClass = 'diffseek-menu-count';
const resetFiltersLabel = 'Reset filters';
const svgNamespace = 'http://www.w3.org/2000/svg';

export type { FilterMenuOptions } from './filter-menu-model';

export function mountFilterMenu(
  menu: HTMLElement,
  options: FilterMenuOptions,
): void {
  if (
    menu.dataset['diffseekMenuOwned'] === 'true' &&
    patchFilterMenu(menu, options)
  ) {
    return;
  }
  const focused = focusedItem(menu);
  menu.querySelector(filtersRootSelector)?.remove();
  if (clearNativeFilters(menu)) return;
  takeOverMenu(menu);
  const root = filtersRoot(options);
  root.addEventListener('keydown', moveFocus);
  menu.append(root);
  restoreFocus(root, focused);
}

function appendAlwaysRead(row: HTMLElement, options: MenuRowModel): void {
  const defaults = options.filterDefaults;
  if (options.facet !== 'generated' || !defaults) return;
  row.append(
    alwaysReadAction({
      disabled: options.disabled === true,
      enabled: defaults.viewed.has('generated'),
      onToggle: (enabled) => {
        if (enabled) defaults.viewed.add('generated');
        else defaults.viewed.delete('generated');
        options.onAlwaysReadChange?.(enabled);
        options.onChange();
      },
    }),
  );
}

function appendBlock(
  content: HTMLElement,
  block: { heading?: string; rows: MenuRowModel[] },
): void {
  if (!present(block.heading)) {
    for (const row of block.rows) appendItem(content, row);
    return;
  }
  appendSeparator(content);
  appendSection(content, block.heading, block.rows);
}

function appendCount(row: HTMLElement, options: MenuRowModel): void {
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
    row.append(menuViewedCounter(actionOptions), menuViewedOverlay(actionOptions));
    return;
  }
  const counter = document.createElement('span');
  counter.className = menuCountClass;
  counter.textContent = `${String(options.visible)}/${String(options.total)}`;
  row.append(counter);
}

function appendItem(root: HTMLElement, options: MenuRowModel): void {
  const row = document.createElement('div');
  row.className = 'diffseek-menu-row';
  row.append(filterCheckbox(options));
  appendAlwaysRead(row, options);
  appendOnly(row, options);
  appendCount(row, options);
  root.append(row);
}

function appendOnly(row: HTMLElement, options: MenuRowModel): void {
  if (!options.onlyValues) return;
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

function appendResetFilters(
  root: HTMLElement,
  options: Pick<FilterMenuOptions, 'filterDefaults' | 'filters' | 'onChange'>,
): void {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'diffseek-reset-filters';
  reset.dataset['resetFilters'] = 'true';
  reset.setAttribute('aria-label', resetFiltersLabel);
  reset.setAttribute('role', 'menuitem');
  reset.title = resetFiltersLabel;
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.dataset['diffseekResetIcon'] = 'true';
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  const path = document.createElementNS(svgNamespace, 'path');
  path.setAttribute('d', 'M3 3v4h4M3.4 6.4A5 5 0 1 1 3 10');
  icon.append(path);
  reset.append(icon);
  reset.addEventListener('click', () => {
    resetTransientExclusions(options.filters, options.filterDefaults);
    options.onChange();
  });
  root.append(reset);
}

function appendSection(
  root: HTMLElement,
  heading: string,
  rows: MenuRowModel[],
): void {
  const first = rows[0];
  const section = document.createElement('section');
  section.className = 'diffseek-menu-section';
  const titleRow = document.createElement('div');
  titleRow.className = 'diffseek-menu-section-title';
  const title = document.createElement('h3');
  title.textContent = heading;
  titleRow.append(title);
  if (first && first.excluded.size > 0) {
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

function appendSeparator(root: HTMLElement): void {
  const separator = document.createElement('div');
  separator.dataset['diffseekSeparator'] = 'true';
  separator.setAttribute('role', 'separator');
  root.append(separator);
}

function clearNativeFilters(menu: HTMLElement): boolean {
  const clear = [
    ...menu.querySelectorAll<HTMLElement>('button, [role="menuitem"]'),
  ].find(
    (item) =>
      !item.closest(filtersRootSelector) &&
      item.textContent.trim() === clearFiltersLabel,
  );
  if (!clear) {
    delete menu.dataset['diffseekNativeClearing'];
    return false;
  }
  if (!present(menu.dataset['diffseekNativeClearing'])) {
    menu.dataset['diffseekNativeClearing'] = 'true';
    clear.click();
  }
  return true;
}

function filterCheckbox(options: MenuRowModel): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'diffseek-menu-item';
  item.setAttribute('role', 'menuitemcheckbox');
  item.dataset['filterKind'] = options.facet;
  item.dataset['filterValue'] = options.value;
  applyCheckedState(item, options);
  syncMenuItemDisabled(item, options.disabled === true);
  const text = document.createElement('span');
  text.textContent = options.label;
  item.append(text);
  item.addEventListener('click', () => {
    onFilterClick(item, options);
  });
  return item;
}

function filtersRoot(options: FilterMenuOptions): HTMLElement {
  const root = document.createElement('li');
  root.dataset['diffseek'] = 'filters';
  root.setAttribute('role', 'none');
  const content = document.createElement('div');
  content.className = 'diffseek-menu-content';
  root.append(content);
  for (const block of menuRowModels(options)) appendBlock(content, block);
  if (hasTransientExclusions(options.filters, options.filterDefaults)) {
    appendResetFilters(root, options);
  }
  return root;
}

function focusedItem(menu: HTMLElement): null | string {
  const active = menu.ownerDocument.activeElement;
  if (
    !(active instanceof HTMLButtonElement) ||
    !active.closest(filtersRootSelector)
  ) {
    return null;
  }
  return itemKey(active);
}

function isElementHidden(element: HTMLElement): boolean {
  return Boolean(element.hidden);
}

function onFilterClick(item: HTMLButtonElement, options: MenuRowModel): void {
  if (item.disabled) return;
  if (cycleFilterDefault(options)) {
    applyCheckedState(item, options);
    if (item.getAttribute(ariaChecked) === 'false') {
      showHideNow(item.ownerDocument);
    }
    options.onChange();
    return;
  }
  if (options.excluded.has(options.value)) options.excluded.delete(options.value);
  else options.excluded.add(options.value);
  item.setAttribute(ariaChecked, String(!options.excluded.has(options.value)));
  options.onChange();
}

function present(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function restoreFocus(root: HTMLElement, focused: null | string): void {
  if (focused === null || focused === '') return;
  [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => itemKey(button) === focused)
    ?.focus();
}

function takeOverMenu(menu: HTMLElement): void {
  menu.dataset['diffseekMenuOwned'] = 'true';
  for (const child of menu.children) {
    if (
      !(child instanceof HTMLElement) ||
      child.dataset['diffseek'] === 'filters' ||
      isElementHidden(child)
    ) {
      continue;
    }
    child.dataset['diffseekNativeHidden'] = 'true';
    child.hidden = true;
  }
}
