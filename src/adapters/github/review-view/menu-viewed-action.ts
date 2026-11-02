import {
  type LabelFacet,
  scopeAriaPressed,
  scopeViewedLabel,
  viewedMark,
} from '@diffseek/review';

import { setDataAttribute } from '../dom-data';

const ariaDisabled = 'aria-disabled';
const menuViewedActionClass = 'diffseek-menu-viewed-action';
const viewedClicks = new WeakMap<
  HTMLButtonElement,
  (event: MouseEvent) => void
>();
const viewedPartialClass = 'diffseek-viewed-partial';

export interface MenuViewedActionOptions {
  counted: number;
  disabled?: boolean;
  facet: LabelFacet;
  onViewed: (viewed: boolean, paths: string[]) => void;
  paths: string[];
  value: string;
  viewedCount: number;
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
    viewedPartialClass,
    pressed === 'mixed' && action.classList.contains(menuViewedActionClass),
  );
  const disabled = options.disabled === true;
  action.disabled = disabled;
  setAriaDisabled(action, disabled);
  bindViewedClick(action, options);
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
  setDataAttribute(counter, 'diffseekMenuCountAction', 'true');
  counter.textContent = `${options.visible}/${options.total}`;
  configureViewedAction(counter, options);
  return counter;
}

export function menuViewedOverlay(
  options: MenuViewedActionOptions,
): HTMLButtonElement {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = menuViewedActionClass;
  setDataAttribute(action, 'diffseekMenuViewedAction', 'true');
  configureViewedAction(action, options);
  return action;
}

function bindViewedClick(
  action: HTMLButtonElement,
  options: MenuViewedActionOptions,
): void {
  const previous = viewedClicks.get(action);
  if (previous) action.removeEventListener('click', previous);
  const marking = viewedMark(options.viewedCount, options.counted) !== 'filled';
  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (options.disabled === true) return;
    options.onViewed(marking, options.paths);
  };
  viewedClicks.set(action, onClick);
  action.addEventListener('click', onClick);
}

function setAriaDisabled(action: HTMLButtonElement, disabled: boolean): void {
  if (disabled) {
    action.setAttribute(ariaDisabled, 'true');
    return;
  }
  action.removeAttribute(ariaDisabled);
}

function setChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
