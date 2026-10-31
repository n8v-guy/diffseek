import {
  categoryViewedNotice,
  scopeAriaPressed,
  scopeViewedLabel,
  viewedMark,
  type LabelFacet,
} from '@diffseek/review';

export type MenuViewedActionOptions = {
  facet: LabelFacet;
  onViewed: (viewed: boolean, paths: string[], notice?: string) => void;
  paths: string[];
  value: string;
  scope: string;
  counted: number;
  viewedCount: number;
  hidden: number;
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
  const label = scopeViewedLabel(
    options.viewedCount,
    options.counted,
    options.scope,
  );
  action.setAttribute('aria-label', label);
  const pressed = scopeAriaPressed(options.viewedCount, options.counted);
  action.setAttribute('aria-pressed', pressed);
  action.title = label;
  action.classList.toggle(
    'diffseek-viewed-partial',
    pressed === 'mixed' && action.classList.contains('diffseek-menu-viewed-action'),
  );
  action.disabled = options.disabled === true;
  if (options.disabled) {
    action.setAttribute('aria-disabled', 'true');
  } else {
    action.removeAttribute('aria-disabled');
  }
  const markViewed = viewedMark(options.viewedCount, options.counted) !== 'filled';
  action.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (options.disabled) return;
    options.onViewed(
      markViewed,
      options.paths,
      categoryViewedNotice(
        options.scope,
        markViewed,
        options.paths.length,
        options.hidden,
      ),
    );
  };
}
