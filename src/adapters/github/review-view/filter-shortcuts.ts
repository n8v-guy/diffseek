import { setDataAttribute } from '../dom-data';

const alwaysReadTitle = 'Always mark generated files viewed';
const ariaLabel = 'aria-label';
const ariaPressed = 'aria-pressed';
const buttonType = 'button';
const stopAlwaysRead = 'Stop marking generated files viewed';

export interface FilterShortcutOptions {
  excluded: Set<string>;
  onChange: () => void;
}

export function alwaysReadAction(options: {
  disabled?: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = buttonType;
  action.className = 'diffseek-menu-always-read';
  setDataAttribute(action, 'diffseekAlwaysRead', 'true');
  action.textContent = 'auto-view';
  action.title = alwaysReadTitle;
  setAlwaysRead(action, options.enabled);
  if (options.disabled === true) action.disabled = true;
  action.addEventListener('click', () => {
    if (action.disabled) return;
    const enabled = action.getAttribute(ariaPressed) !== 'true';
    setAlwaysRead(action, enabled);
    options.onToggle(enabled);
  });
  return action;
}

export function itemOnlyAction(
  options: FilterShortcutOptions & {
    label: string;
    value: string;
    values: string[];
  },
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = buttonType;
  action.className = 'diffseek-menu-only';
  setDataAttribute(action, 'filterOnly', 'true');
  action.setAttribute(ariaLabel, `Show only ${options.label}`);
  action.setAttribute(
    ariaPressed,
    String(onlyFocusApplied(options.value, options.values, options.excluded)),
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

export function sectionAllAction(
  options: FilterShortcutOptions & { heading: string },
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = buttonType;
  action.className = 'diffseek-menu-all';
  setDataAttribute(action, 'filterAll', 'true');
  action.setAttribute(ariaLabel, `Show all ${options.heading}`);
  action.textContent = 'all';
  action.addEventListener('click', () => {
    options.excluded.clear();
    options.onChange();
  });
  return action;
}

function setAlwaysRead(action: HTMLButtonElement, enabled: boolean): void {
  action.setAttribute(ariaPressed, String(enabled));
  action.setAttribute(ariaLabel, enabled ? stopAlwaysRead : alwaysReadTitle);
}
