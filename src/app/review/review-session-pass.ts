import type { PageSnapshot } from '@diffseek/github/review-page/page-adapter';
import type { ReviewPresenter } from '@diffseek/github/review-view/presenter';

import {
  mountViewedActions,
  type ViewedTarget,
} from '@diffseek/github/review-page/viewed-actions';
import { type FilterState, ReviewIndex } from '@diffseek/review';

import type { ViewedActionExecutor } from './action-executor';

interface ProjectionPass {
  changed: boolean;
  defaultViewedPaths: string[];
  fingerprint: string;
  generatedDefaultBusy: boolean;
  menus: HTMLElement[];
  staleMenus: HTMLElement[];
}

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export async function enqueueDefaultViewed(
  enqueue: ViewedActionExecutor['enqueue'],
  command: Parameters<ViewedActionExecutor['enqueue']>[0],
): Promise<Awaited<ReturnType<ViewedActionExecutor['enqueue']>>> {
  try {
    return await enqueue(command);
  } catch {
    return null;
  }
}

export function viewedPathFromClick(
  event: MouseEvent,
  view: Document['defaultView'],
  snapshot: null | SupportedSnapshot,
): string | undefined {
  if (!event.isTrusted || view === null) return undefined;
  const target = event.target;
  if (!(target instanceof view.Element)) return undefined;
  const button = target.closest('button');
  if (!(button instanceof view.HTMLButtonElement)) return undefined;
  return snapshot?.files.find(
    (file) => snapshot.viewedControl(file.path) === button,
  )?.path;
}

export function writeSessionProjection(input: {
  batch: (target: ViewedTarget, viewed: boolean, paths: string[]) => void;
  catalogSnapshot: SupportedSnapshot;
  enqueueDefault: (paths: string[]) => void;
  filters: FilterState;
  mount: (
    menu: HTMLElement,
    snapshot: SupportedSnapshot,
    generatedDefaultBusy: boolean,
  ) => void;
  presenter: ReviewPresenter;
  projection: ProjectionPass;
  setFingerprint: (fingerprint: string) => void;
  structureChanged: boolean;
}): void {
  const { projection } = input;
  if (input.structureChanged || projection.changed) {
    const index = new ReviewIndex(input.catalogSnapshot.files);
    input.presenter.apply(input.catalogSnapshot, input.filters, index);
    mountViewedActions(
      input.catalogSnapshot,
      (target, viewed, paths): void => {
        input.batch(target, viewed, paths);
      },
      index,
      input.filters,
    );
  }
  if (projection.changed) {
    input.setFingerprint(projection.fingerprint);
    if (projection.defaultViewedPaths.length > 0) {
      input.enqueueDefault(projection.defaultViewedPaths);
    }
  }
  const menus = projection.changed ? projection.menus : projection.staleMenus;
  for (const menu of menus) {
    input.mount(menu, input.catalogSnapshot, projection.generatedDefaultBusy);
  }
}
