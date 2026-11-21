import type { FilterDefaults } from '@diffseek/browser';
import {
  afterCurrentTask,
  viewedControlState,
  type PageSnapshot,
} from '@diffseek/github';
import {
  parseCodeowners,
  rulesFromMetadata,
  type RepositoryMetadata,
} from '@diffseek/repository-metadata';
import { labelFiles, type FileRecord } from '@diffseek/review';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export function classifyKeyFor(
  metadata: RepositoryMetadata,
  files: readonly FileRecord[],
): string {
  return [
    metadata.codeowners,
    metadata.attributes,
    JSON.stringify(metadata.nestedAttributes),
    files
      .map((file) => `${file.path}\0${file.status}\0${file.owners.join(',')}\0${file.generatedOnPage === true ? 'page' : ''}`)
      .join('\n'),
  ].join('\n--\n');
}

export function classifySnapshot(
  snapshot: SupportedSnapshot,
  metadata: RepositoryMetadata,
): void {
  labelFiles(snapshot.files, {
    attributes: rulesFromMetadata(metadata),
    codeowners: metadata.codeowners
      ? parseCodeowners(metadata.codeowners)
      : [],
  });
}

/**
 * Auto-view's work in this pull. `pending` are loaded generated files to mark
 * now. `outstanding` is true while any generated file is neither viewed nor
 * tried, loaded or not, or while metadata is still settling: a file whose
 * diff has not loaded has no Viewed button yet and is marked once it loads.
 */
export function autoViewWork(
  files: readonly FileRecord[],
  defaults: FilterDefaults,
  attempts: ReadonlySet<string>,
  settled: boolean,
): { pending: string[]; outstanding: boolean } {
  if (!settled) return { pending: [], outstanding: true };
  if (!defaults.viewed.has('generated')) return { pending: [], outstanding: false };
  const left = files.filter(
    (file) => file.generated && !file.viewed && !attempts.has(file.path),
  );
  return {
    pending: left.filter((file) => file.capabilities.viewed).map((file) => file.path),
    outstanding: left.length > 0,
  };
}

export function syncViewedLabels(files: FileRecord[]): void {
  for (const file of files) {
    const rest = file.labels.filter((label) => label.facet !== 'viewed');
    file.labels = file.viewed
      ? [{ facet: 'viewed', value: 'true' }, ...rest]
      : rest;
  }
}

export function retainNativeOwners(
  snapshot: SupportedSnapshot,
  observedOwners: Map<string, string[]>,
): void {
  for (const file of snapshot.files) {
    if (file.owners.length > 0) {
      observedOwners.set(file.path, file.owners);
    } else {
      file.owners = observedOwners.get(file.path) ?? [];
    }
  }
}

export function refreshViewedState(
  snapshot: SupportedSnapshot,
  files: readonly FileRecord[],
): void {
  for (const file of files) {
    const control = snapshot.viewedControl(file.path);
    const viewed = control ? viewedControlState(control) : null;
    if (viewed != null) file.viewed = viewed;
  }
}

export type PanelScheduleOptions = {
  immediate?: boolean;
  coalesce?: boolean;
};

export type PanelReconcileSchedule = {
  /** Cancels the queued pass; null when nothing is queued. */
  cancel: (() => void) | null;
  /** The queued pass runs as the next task rather than at the next frame. */
  immediate: boolean;
};

export function pageNodesChanged(
  previousTree: Element | null,
  tree: Element | null,
  previousRegions: readonly Element[],
  regions: readonly Element[],
): boolean {
  return (
    previousTree !== tree ||
    previousRegions.length !== regions.length ||
    regions.some((region, index) => region !== previousRegions[index])
  );
}

/**
 * Immediate passes run as the next task. Coalesced passes (streamed tree and
 * panel structure) run once at the next animation frame, so a burst of
 * mutations inside one frame costs one pass and lands before that frame
 * paints. No timers: the browser's frame is the batching event.
 */
export function queuePanelReconcile(
  state: PanelReconcileSchedule,
  root: Document,
  options: PanelScheduleOptions,
  run: () => void,
): void {
  const immediate = options.immediate === true || options.coalesce !== true;
  // A queued pass that runs at least as soon already covers this request.
  if (state.cancel && (state.immediate || !immediate)) return;
  state.cancel?.();
  state.immediate = immediate;
  const fire = () => {
    state.cancel = null;
    state.immediate = false;
    run();
  };
  const view = root.defaultView;
  if (immediate || !view) {
    state.cancel = afterCurrentTask(fire);
    return;
  }
  const frame = view.requestAnimationFrame(fire);
  state.cancel = () => view.cancelAnimationFrame(frame);
}

export function cancelPanelReconcile(state: PanelReconcileSchedule): void {
  state.cancel?.();
  state.cancel = null;
  state.immediate = false;
}
