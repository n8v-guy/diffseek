const filterKindSelector = '[data-filter-kind]';

export function itemKey(button: HTMLButtonElement): string {
  if (present(button.dataset['resetFilters'])) return 'reset-filters';
  if (present(button.dataset['diffseekAlwaysRead'])) return 'always-read';
  if (present(button.dataset['filterOnly'])) return rowActionKey('only', button);
  if (present(button.dataset['filterAll'])) {
    const facet = button
      .closest('.diffseek-menu-section')
      ?.querySelector<HTMLButtonElement>(filterKindSelector);
    return ['all', facet?.dataset['filterKind']].join('\0');
  }
  if (present(button.dataset['diffseekMenuCountAction'])) {
    return [
      'viewed-count',
      button.dataset['viewedFacet'],
      button.dataset['viewedValue'],
    ].join('\0');
  }
  if (present(button.dataset['diffseekMenuViewedAction'])) {
    return [
      'viewed-overlay',
      button.dataset['viewedFacet'],
      button.dataset['viewedValue'],
    ].join('\0');
  }
  return [
    'filter',
    button.dataset['filterKind'],
    button.dataset['filterValue'],
    button.dataset['batchViewed'],
  ].join('\0');
}

export function moveFocus(event: KeyboardEvent): void {
  if (
    !['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key) ||
    !(event.currentTarget instanceof HTMLElement)
  ) return;
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
  return [action, item?.dataset['filterKind'], item?.dataset['filterValue']].join(
    '\0',
  );
}
