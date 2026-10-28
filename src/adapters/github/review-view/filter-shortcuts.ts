export type FilterShortcutOptions = {
  excluded: Set<string>;
  onChange: () => void;
};

export function itemOnlyAction(
  options: FilterShortcutOptions & {
    label: string;
    value: string;
    values: string[];
  },
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'diffseek-menu-only';
  action.dataset.filterOnly = 'true';
  action.setAttribute('aria-label', `Show only ${options.label}`);
  action.textContent = 'only';
  action.addEventListener('click', () => {
    options.excluded.clear();
    for (const value of options.values) {
      if (value !== options.value) options.excluded.add(value);
    }
    options.onChange();
  });
  return action;
}

export function alwaysReadAction(options: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: (enabled: boolean) => void;
}): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'diffseek-menu-always-read';
  action.dataset.diffseekAlwaysRead = 'true';
  action.textContent = 'always read';
  setAlwaysRead(action, options.enabled);
  if (options.disabled) action.disabled = true;
  action.addEventListener('click', () => {
    if (action.disabled) return;
    const enabled = action.getAttribute('aria-pressed') !== 'true';
    setAlwaysRead(action, enabled);
    options.onToggle(enabled);
  });
  return action;
}

function setAlwaysRead(action: HTMLButtonElement, enabled: boolean): void {
  action.setAttribute('aria-pressed', String(enabled));
  action.setAttribute(
    'aria-label',
    enabled
      ? 'Stop always marking generated files viewed'
      : 'Always mark generated files viewed',
  );
}

export function sectionAllAction(
  options: FilterShortcutOptions & { heading: string },
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'diffseek-menu-all';
  action.dataset.filterAll = 'true';
  action.setAttribute('aria-label', `Show all ${options.heading}`);
  action.textContent = 'all';
  action.addEventListener('click', () => {
    options.excluded.clear();
    options.onChange();
  });
  return action;
}
