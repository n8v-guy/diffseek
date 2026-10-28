import {
  facetChoices,
  facetDefinitions,
  isFallbackFacetValue,
  type FacetProjection,
  type LabelFacet,
  projectFacet,
} from '@diffseek/review';

import {
  applyCheckedState,
  cycleFilterDefault,
} from './filter-default-state';
import {
  itemKey,
  moveFocus,
} from './filter-menu-keyboard';
import {
  displayLabel,
  emptyProjection,
  type FilterMenuOptions,
  type MenuRowModel,
  selection,
  sharedOwnerPrefix,
} from './filter-menu-model';
import { patchFilterMenu } from './filter-menu-patch';
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

const filtersRootSelector = '[data-diffseek="filters"]';

type FilterSectionOptions = {
  facet: LabelFacet;
  heading: string;
  choices: Array<FacetProjection & { label: string; value: string }>;
  excluded: Set<string>;
  onChange: () => void;
  onViewed?: (viewed: boolean, paths: string[]) => void;
};

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

  const labelSets = options.files.map((file) => file.labels);
  const viewed =
    projectFacet('viewed', options.files, options.filters).get('true') ??
    emptyProjection();
  appendItem(content, {
    ...viewed,
    facet: 'viewed',
    label: 'Viewed files',
    value: 'true',
    excluded: selection(options.filters, 'viewed'),
    filterDefaults: options.filterDefaults,
    onChange: options.onChange,
    onFilterDefaultChange: options.onFilterDefaultChange,
    onViewed: options.onViewed,
  });
  const generated = projectFacet(
    'generated',
    options.files,
    options.filters,
  ).get('true');
  if (generated && generated.total > 0) {
    appendItem(content, {
      ...generated,
      facet: 'generated',
      label: 'Generated files',
      value: 'true',
      excluded: selection(options.filters, 'generated'),
      filterDefaults: options.filterDefaults,
      disabled: options.generatedDefaultBusy === true,
      onChange: options.onChange,
      onFilterDefaultChange: options.onFilterDefaultChange,
      onAlwaysReadChange: options.onAlwaysReadChange,
      onViewed: options.onViewed,
    });
  }

  const sections = facetDefinitions
    .filter(
      (definition) =>
        !definition.native &&
        definition.facet !== 'generated' &&
        definition.facet !== 'viewed',
    )
    .map((definition): FilterSectionOptions => {
      const projections = projectFacet(
        definition.facet,
        options.files,
        options.filters,
      );
      const values = facetChoices(
        definition.facet,
        labelSets,
        options.filters,
      );
      const ownerPrefix =
        definition.facet === 'owners' ? sharedOwnerPrefix(values) : null;
      return {
        facet: definition.facet,
        heading: definition.heading,
        choices: values.map((value) => ({
          ...(projections.get(value) ?? emptyProjection()),
          label: displayLabel(
            definition.label(value),
            value,
            definition.facet,
            ownerPrefix,
          ),
          value,
        })),
        excluded: selection(options.filters, definition.facet),
        onChange: options.onChange,
        onViewed: options.onViewed,
      };
    })
    .filter(
      (section) =>
        section.choices.length > 0 &&
        !(
          section.choices.length === 1 &&
          isFallbackFacetValue(
            section.facet,
            section.choices[0]?.value ?? '',
          )
        ),
    );
  if (sections.length > 0) appendSeparator(content);
  for (const [index, section] of sections.entries()) {
    appendSection(content, section);
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

function appendSection(
  root: HTMLElement,
  options: FilterSectionOptions,
): void {
  const section = document.createElement('section');
  section.className = 'diffseek-menu-section';
  const titleRow = document.createElement('div');
  titleRow.className = 'diffseek-menu-section-title';
  const title = document.createElement('h3');
  title.textContent = options.heading;
  titleRow.append(title);
  if (options.excluded.size > 0) {
    titleRow.append(
      sectionAllAction({
        excluded: options.excluded,
        heading: options.heading,
        onChange: options.onChange,
      }),
    );
  }
  section.append(titleRow);

  for (const choice of options.choices) {
    appendItem(section, {
      ...choice,
      facet: options.facet,
      excluded: options.excluded,
      onlyValues:
        options.choices.length > 1
          ? options.choices.map(({ value }) => value)
          : undefined,
      onChange: options.onChange,
      onViewed: options.onViewed,
    });
  }

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
  if (options.disabled) {
    item.disabled = true;
    item.setAttribute('aria-disabled', 'true');
    item.setAttribute('aria-busy', 'true');
  }
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
  const escapeViewed = options.hiddenViewedPaths.length > 0;
  const actionPaths = escapeViewed
    ? options.hiddenViewedPaths
    : options.paths;
  if (actionPaths.length > 0 && onViewed) {
    const actionOptions = {
      ...options,
      onViewed,
      paths: actionPaths,
      viewed: escapeViewed || options.viewed,
      disabled: options.disabled === true,
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
