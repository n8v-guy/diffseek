export function moveFocus(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const root = event.currentTarget as HTMLElement;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
  if (buttons.length === 0) return;
  const current = buttons.indexOf(
    root.ownerDocument.activeElement as HTMLButtonElement,
  );
  let next = current;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = buttons.length - 1;
  if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
  if (event.key === 'ArrowUp') {
    next = (current - 1 + buttons.length) % buttons.length;
  }
  event.preventDefault();
  buttons[next]?.focus();
}

export function itemKey(button: HTMLButtonElement): string {
  if (button.dataset.resetFilters) return 'reset-filters';
  if (button.dataset.filterOnly) {
    return rowActionKey('only', button);
  }
  if (button.dataset.filterAll) {
    const facet = button
      .closest('.diffseek-menu-section')
      ?.querySelector<HTMLButtonElement>('[data-filter-kind]')
      ?.dataset.filterKind;
    return ['all', facet].join('\u0000');
  }
  if (button.dataset.diffseekMenuCountAction) {
    return [
      'viewed-count',
      button.dataset.viewedFacet,
      button.dataset.viewedValue,
    ].join('\u0000');
  }
  if (button.dataset.diffseekMenuViewedAction) {
    return [
      'viewed-overlay',
      button.dataset.viewedFacet,
      button.dataset.viewedValue,
    ].join('\u0000');
  }
  return [
    'filter',
    button.dataset.filterKind,
    button.dataset.filterValue,
    button.dataset.batchViewed,
  ].join('\u0000');
}

function rowActionKey(action: string, button: HTMLButtonElement): string {
  const item = button
    .closest('.diffseek-menu-row')
    ?.querySelector<HTMLButtonElement>('[data-filter-kind]');
  return [
    action,
    item?.dataset.filterKind,
    item?.dataset.filterValue,
  ].join('\u0000');
}
