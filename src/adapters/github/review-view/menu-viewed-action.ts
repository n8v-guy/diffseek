import type { LabelFacet } from '@diffseek/review';

export type MenuViewedActionOptions = {
  facet: LabelFacet;
  onViewed: (viewed: boolean, paths: string[]) => void;
  paths: string[];
  value: string;
  viewed: boolean;
  disabled?: boolean;
};

export function menuViewedOverlay(
  options: MenuViewedActionOptions,
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'diffseek-menu-viewed-action';
  action.dataset.diffseekMenuViewedAction = 'true';
  configureViewedAction(action, options);
  return action;
}

export function menuViewedCounter(
  options: MenuViewedActionOptions & {
    total: number;
    visible: number;
  },
): HTMLButtonElement {
  const counter = document.createElement('button');
  counter.type = 'button';
  counter.className = 'diffseek-menu-count';
  counter.dataset.diffseekMenuCountAction = 'true';
  counter.textContent = `${options.visible}/${options.total}`;
  configureViewedAction(counter, options);
  return counter;
}

export function configureViewedAction(
  action: HTMLButtonElement,
  options: MenuViewedActionOptions,
): void {
  action.dataset.viewedFacet = options.facet;
  action.dataset.viewedValue = options.value;
  const label = options.viewed ? 'Mark as not viewed' : 'Mark as viewed';
  action.setAttribute('aria-label', label);
  action.setAttribute('aria-pressed', String(options.viewed));
  action.title = label;
  action.disabled = options.disabled === true;
  if (options.disabled) {
    action.setAttribute('aria-disabled', 'true');
  } else {
    action.removeAttribute('aria-disabled');
  }
  action.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (options.disabled) return;
    options.onViewed(!options.viewed, options.paths);
  };
}
