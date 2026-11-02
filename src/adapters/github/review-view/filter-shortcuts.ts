const ariaLabelAttribute = 'aria-label';
const ariaPressedAttribute = 'aria-pressed';

export type FilterShortcutOptions = {
  excluded: Set<string>;
  onChange: () => void;
};

export function onlyFocusApplied(
  value: string,
  values: readonly string[],
  excluded: ReadonlySet<string>,
): boolean {
  return (
    !excluded.has(value) &&
    values.every((entry) => entry === value || excluded.has(entry))
  );
}

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
  action.setAttribute(ariaLabelAttribute, `Show only ${options.label}`);
  action.setAttribute(
    ariaPressedAttribute,
    String(
      onlyFocusApplied(options.value, options.values, options.excluded),
    ),
  );
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
  action.textContent = 'auto-view';
  action.title = 'Always mark generated files viewed';
  setAlwaysRead(action, options.enabled);
  if (options.disabled) action.disabled = true;
  action.addEventListener('click', () => {
    if (action.disabled) return;
    const enabled = action.getAttribute(ariaPressedAttribute) !== 'true';
    setAlwaysRead(action, enabled);
    options.onToggle(enabled);
  });
  return action;
}

function setAlwaysRead(action: HTMLButtonElement, enabled: boolean): void {
  action.setAttribute(ariaPressedAttribute, String(enabled));
  action.setAttribute(
    ariaLabelAttribute,
    enabled
      ? 'Stop marking generated files viewed'
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
  action.setAttribute(ariaLabelAttribute, `Show all ${options.heading}`);
  action.textContent = 'all';
  action.addEventListener('click', () => {
    options.excluded.clear();
    options.onChange();
  });
  return action;
}
