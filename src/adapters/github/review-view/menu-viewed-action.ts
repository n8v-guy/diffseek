import {
  scopeAriaPressed,
  scopeViewedLabel,
  viewedMark,
  type LabelFacet,
} from '@diffseek/review';

export type MenuViewedActionOptions = {
  facet: LabelFacet;
  onViewed: (viewed: boolean, paths: string[]) => void;
  paths: string[];
  value: string;
  counted: number;
  viewedCount: number;
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

export type MenuCount = { total: number; visible: number; settling?: boolean };

/** Shown/total, or "…" while the counts can still change on their own. */
export function menuCountText(count: MenuCount): string {
  return count.settling === true ? '…' : `${count.visible}/${count.total}`;
}

/** Edits the counter's text node in place, so a count change adds no nodes. */
export function syncCountText(counter: HTMLElement, text: string): void {
  if (counter.textContent === text) return;
  const node = counter.firstChild;
  if (node instanceof Text && counter.childNodes.length === 1) node.data = text;
  else counter.textContent = text;
}

export function menuViewedCounter(
  options: MenuViewedActionOptions & MenuCount,
): HTMLButtonElement {
  const counter = document.createElement('button');
  counter.type = 'button';
  counter.className = 'diffseek-menu-count';
  counter.dataset.diffseekMenuCountAction = 'true';
  counter.textContent = menuCountText(options);
  configureViewedAction(counter, options);
  return counter;
}

export function configureViewedAction(
  action: HTMLButtonElement,
  options: MenuViewedActionOptions,
): void {
  // Write only what changed: menus are refreshed on every reconcile pass.
  setChanged(action, 'data-viewed-facet', options.facet);
  setChanged(action, 'data-viewed-value', options.value);
  const label = scopeViewedLabel(options.viewedCount, options.counted);
  setChanged(action, 'aria-label', label);
  const pressed = scopeAriaPressed(options.viewedCount, options.counted);
  setChanged(action, 'aria-pressed', pressed);
  setChanged(action, 'title', label);
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
    options.onViewed(markViewed, options.paths);
  };
}

function setChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
