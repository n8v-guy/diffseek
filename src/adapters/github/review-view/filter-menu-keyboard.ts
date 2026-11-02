import { dataAttribute } from '../dom-data';

const filterKindSelector = '[data-filter-kind]';

export function itemKey(button: HTMLButtonElement): string {
  if (present(dataAttribute(button, 'resetFilters'))) return 'reset-filters';
  if (present(dataAttribute(button, 'diffseekAlwaysRead'))) return 'always-read';
  if (present(dataAttribute(button, 'filterOnly'))) return rowActionKey('only', button);
  if (present(dataAttribute(button, 'filterAll'))) {
    const facet = button
      .closest('.diffseek-menu-section')
      ?.querySelector<HTMLButtonElement>(filterKindSelector);
    return ['all', dataAttribute(facet, 'filterKind')].join('\0');
  }
  if (present(dataAttribute(button, 'diffseekMenuCountAction'))) {
    return [
      'viewed-count',
      dataAttribute(button, 'viewedFacet'),
      dataAttribute(button, 'viewedValue'),
    ].join('\0');
  }
  if (present(dataAttribute(button, 'diffseekMenuViewedAction'))) {
    return [
      'viewed-overlay',
      dataAttribute(button, 'viewedFacet'),
      dataAttribute(button, 'viewedValue'),
    ].join('\0');
  }
  return [
    'filter',
    dataAttribute(button, 'filterKind'),
    dataAttribute(button, 'filterValue'),
    dataAttribute(button, 'batchViewed'),
  ].join('\0');
}

export function moveFocus(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key) || !(event.currentTarget instanceof HTMLElement)) return;
  const root = event.currentTarget;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
  if (buttons.length === 0) return;
  const active = root.ownerDocument.activeElement;
  const current = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
  const next = focusIndex(event.key, current, buttons.length);
  event.preventDefault();
  buttons[next]?.focus();
}

function focusIndex(key: string, current: number, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  return current;
}

function present(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

function rowActionKey(action: string, button: HTMLButtonElement): string {
  const item = button
    .closest('.diffseek-menu-row')
    ?.querySelector<HTMLButtonElement>(filterKindSelector);
  return [action, dataAttribute(item, 'filterKind'), dataAttribute(item, 'filterValue')].join(
    '\0',
  );
}
