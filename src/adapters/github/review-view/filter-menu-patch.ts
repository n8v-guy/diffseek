import { applyCheckedState } from './filter-default-state';
import {
  type FilterMenuOptions,
  menuRowModels,
} from './filter-menu-model';
import { hasTransientExclusions } from './filter-reset';
import { configureViewedAction } from './menu-viewed-action';

const filtersRootSelector = '[data-diffseek="filters"]';

export function patchFilterMenu(
  menu: HTMLElement,
  options: FilterMenuOptions,
): boolean {
  const root = menu.querySelector<HTMLElement>(filtersRootSelector);
  if (!root) return false;
  const rows = menuRowModels(options);
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>(
      '[data-filter-kind][data-filter-value]',
    ),
  ];
  if (buttons.length !== rows.length) return false;
  for (const [index, row] of rows.entries()) {
    const button = buttons[index];
    if (
      !button ||
      button.dataset.filterKind !== row.facet ||
      button.dataset.filterValue !== row.value
    ) {
      return false;
    }
    const section = button.closest('.diffseek-menu-section');
    if (
      section &&
      (section.querySelector('[data-filter-all]') != null) !==
        (row.excluded.size > 0)
    ) {
      return false;
    }
  }
  const wantsReset = hasTransientExclusions(
    options.filters,
    options.filterDefaults,
  );
  if (wantsReset !== (root.querySelector('[data-reset-filters]') != null)) {
    return false;
  }

  for (const [index, row] of rows.entries()) {
    if (!patchRow(buttons[index], row)) return false;
  }
  return true;
}

function patchRow(
  button: HTMLButtonElement | undefined,
  row: ReturnType<typeof menuRowModels>[number],
): boolean {
  if (!button) return false;
  const rowElement = button.closest('.diffseek-menu-row');
  if (!(rowElement instanceof HTMLElement)) return false;
  applyCheckedState(button, row);
  button.disabled = row.disabled === true;
  if (row.disabled) {
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
  } else {
    button.removeAttribute('aria-disabled');
    button.removeAttribute('aria-busy');
  }
  const escapeViewed = row.hiddenViewedPaths.length > 0;
  const actionPaths = escapeViewed ? row.hiddenViewedPaths : row.paths;
  const onViewed = row.onViewed;
  const counter = rowElement.querySelector<HTMLElement>('.diffseek-menu-count');
  const viewedAction = rowElement.querySelector<HTMLButtonElement>(
    '[data-diffseek-menu-viewed-action]',
  );
  const countAction = rowElement.querySelector<HTMLButtonElement>(
    '[data-diffseek-menu-count-action]',
  );
  if (actionPaths.length > 0 && onViewed) {
    if (!countAction || !viewedAction) return false;
    const actionOptions = {
      facet: row.facet,
      onViewed,
      paths: actionPaths,
      value: row.value,
      viewed: escapeViewed || row.viewed,
      disabled: row.disabled === true,
    };
    const count = `${row.visible}/${row.total}`;
    if (countAction.textContent !== count) countAction.textContent = count;
    configureViewedAction(countAction, actionOptions);
    configureViewedAction(viewedAction, actionOptions);
    return true;
  }
  if (countAction || viewedAction) return false;
  if (counter) {
    const count = `${row.visible}/${row.total}`;
    if (counter.textContent !== count) counter.textContent = count;
    return true;
  }
  return false;
}
