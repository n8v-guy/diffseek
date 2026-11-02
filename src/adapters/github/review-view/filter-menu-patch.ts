import { dataAttribute } from '../dom-data';

import { applyCheckedState } from './filter-default-state';
import {
  type FilterMenuOptions,
  type MenuRowModel,
  menuRowModels,
} from './filter-menu-model';
import { hasTransientExclusions } from './filter-reset';
import { onlyFocusApplied } from './filter-shortcuts';
import { configureViewedAction } from './menu-viewed-action';

const alwaysReadTitle = 'Always mark generated files viewed';
const ariaBusy = 'aria-busy';
const ariaDisabled = 'aria-disabled';
const ariaPressed = 'aria-pressed';
const filterButtonSelector = '[data-filter-kind][data-filter-value]';
const stopAlwaysRead = 'Stop marking generated files viewed';

export const filtersRootSelector = '[data-diffseek="filters"]';

export function patchFilterMenu(
  menu: HTMLElement,
  options: FilterMenuOptions,
): boolean {
  const root = menu.querySelector<HTMLElement>(filtersRootSelector);
  if (!root) return false;
  const rows = menuRowModels(options).flatMap((section) => section.rows);
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>(filterButtonSelector),
  ];
  if (!rowsMatchButtons(buttons, rows)) return false;
  const wantsReset = hasTransientExclusions(
    options.filters,
    options.filterDefaults,
  );
  const hasReset = root.querySelector('[data-reset-filters]') !== null;
  if (wantsReset !== hasReset) return false;
  for (const [index, row] of rows.entries()) {
    if (!patchRow(buttons[index], row)) return false;
  }
  return true;
}

export function syncMenuItemDisabled(
  button: HTMLButtonElement,
  disabled: boolean,
): void {
  button.disabled = disabled;
  if (disabled) {
    button.setAttribute(ariaDisabled, 'true');
    button.setAttribute(ariaBusy, 'true');
    return;
  }
  button.removeAttribute(ariaDisabled);
  button.removeAttribute(ariaBusy);
}

function patchAlwaysRead(rowElement: HTMLElement, row: MenuRowModel): boolean {
  const alwaysRead = rowElement.querySelector<HTMLButtonElement>(
    '[data-diffseek-always-read]',
  );
  const defaults = row.filterDefaults;
  if (row.facet !== 'generated' || !defaults) return alwaysRead === null;
  if (!alwaysRead) return false;
  const enabled = defaults.viewed.has('generated');
  alwaysRead.disabled = row.disabled === true;
  alwaysRead.title = alwaysReadTitle;
  alwaysRead.setAttribute(ariaPressed, String(enabled));
  alwaysRead.setAttribute(
    'aria-label',
    enabled ? stopAlwaysRead : alwaysReadTitle,
  );
  return true;
}

function patchOnly(rowElement: HTMLElement, row: MenuRowModel): boolean {
  const only = rowElement.querySelector<HTMLButtonElement>('[data-filter-only]');
  const values = row.onlyValues;
  if (!values) return only === null;
  if (!only) return false;
  only.setAttribute(
    ariaPressed,
    String(onlyFocusApplied(row.value, values, row.excluded)),
  );
  return true;
}

function patchRow(
  button: HTMLButtonElement | undefined,
  row: MenuRowModel,
): boolean {
  if (!button) return false;
  const rowElement = button.closest('.diffseek-menu-row');
  if (!(rowElement instanceof HTMLElement)) return false;
  applyCheckedState(button, row);
  if (!patchAlwaysRead(rowElement, row) || !patchOnly(rowElement, row)) {
    return false;
  }
  syncMenuItemDisabled(button, row.disabled === true);
  return patchViewed(rowElement, row);
}

function patchViewed(rowElement: HTMLElement, row: MenuRowModel): boolean {
  const counter = rowElement.querySelector<HTMLElement>('.diffseek-menu-count');
  const viewedAction = rowElement.querySelector<HTMLButtonElement>(
    '[data-diffseek-menu-viewed-action]',
  );
  const countAction = rowElement.querySelector<HTMLButtonElement>(
    '[data-diffseek-menu-count-action]',
  );
  const onViewed = row.onViewed;
  if (row.paths.length > 0 && onViewed) {
    return patchViewedActions(row, onViewed, countAction, viewedAction);
  }
  if (countAction || viewedAction || !counter) return false;
  setCount(counter, row);
  return true;
}

function patchViewedActions(
  row: MenuRowModel,
  onViewed: (viewed: boolean, paths: string[]) => void,
  countAction: HTMLButtonElement | null,
  viewedAction: HTMLButtonElement | null,
): boolean {
  if (!countAction || !viewedAction) return false;
  const actionOptions = {
    counted: row.counted,
    disabled: row.disabled === true,
    facet: row.facet,
    onViewed,
    paths: row.paths,
    value: row.value,
    viewedCount: row.viewedCount,
  };
  setCount(countAction, row);
  configureViewedAction(countAction, actionOptions);
  configureViewedAction(viewedAction, actionOptions);
  return true;
}

function rowsMatchButtons(
  buttons: HTMLButtonElement[],
  rows: MenuRowModel[],
): boolean {
  if (buttons.length !== rows.length) return false;
  for (const [index, row] of rows.entries()) {
    const button = buttons[index];
    if (
      button === undefined ||
      dataAttribute(button, 'filterKind') !== row.facet ||
      dataAttribute(button, 'filterValue') !== row.value ||
      !sectionShortcutMatches(button, row)
    ) {
      return false;
    }
  }
  return true;
}

function sectionShortcutMatches(
  button: HTMLButtonElement,
  row: MenuRowModel,
): boolean {
  const section = button.closest('.diffseek-menu-section');
  if (!section) return true;
  const hasAll = section.querySelector('[data-filter-all]') !== null;
  return hasAll === row.excluded.size > 0;
}

function setCount(element: HTMLElement, row: MenuRowModel): void {
  const count = `${row.visible}/${row.total}`;
  if (element.textContent !== count) element.textContent = count;
}
