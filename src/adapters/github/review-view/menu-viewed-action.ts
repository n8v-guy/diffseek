import type { LabelFacet } from '@diffseek/review';

export type MenuViewedActionOptions = {
  facet: LabelFacet;
  onViewed: (viewed: boolean, paths: string[]) => void;
  paths: string[];
  value: string;
  viewed: boolean;
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

function configureViewedAction(
  action: HTMLButtonElement,
  options: MenuViewedActionOptions,
): void {
  action.dataset.viewedFacet = options.facet;
  action.dataset.viewedValue = options.value;
  const label = options.viewed ? 'Mark as not viewed' : 'Mark as viewed';
  action.setAttribute('aria-label', label);
  action.setAttribute('aria-pressed', String(options.viewed));
  action.title = label;
  action.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onViewed(!options.viewed, options.paths);
  });
}
