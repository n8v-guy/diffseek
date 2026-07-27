import type { PageSnapshot } from '@diffseek/github/review-page/page-adapter';
import {
  markViewed,
  type ActionResult,
} from '@diffseek/github/review-page/viewed-actions';

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

export type ViewedCommand = {
  reviewKey: string;
  generation: number;
  viewed: boolean;
  paths: string[];
  onProgress?: (completed: number, requested: number) => void;
};

type CurrentReviewState = {
  reviewKey: string;
  generation: number;
  snapshot: SupportedSnapshot;
};

type ViewedActionExecutorOptions = {
  current: () => CurrentReviewState | null;
  beforeExecute?: () => Promise<void>;
  markFiles?: typeof markViewed;
};

export class ViewedActionExecutor {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private active: AbortController | null = null;
  private readonly revisions = new Map<string, number>();
  private readonly current: () => CurrentReviewState | null;
  private readonly beforeExecute: () => Promise<void>;
  private readonly markFiles: typeof markViewed;

  constructor(options: ViewedActionExecutorOptions) {
    this.current = options.current;
    this.beforeExecute = options.beforeExecute ?? (() => Promise.resolve());
    this.markFiles = options.markFiles ?? markViewed;
  }

  enqueue(command: ViewedCommand): Promise<ActionResult | null> {
    const epoch = this.epoch;
    const revisions = new Map(
      command.paths.map((path) => [path, this.revision(path)]),
    );
    const result = this.tail.then(() =>
      this.execute(command, epoch, revisions),
    );
    this.tail = result.catch(() => undefined);
    return result;
  }

  invalidate(path: string): void {
    this.revisions.set(path, this.revision(path) + 1);
  }

  cancel(): void {
    this.epoch += 1;
    this.active?.abort();
    this.active = null;
  }

  private async execute(
    command: ViewedCommand,
    epoch: number,
    revisions: ReadonlyMap<string, number>,
  ): Promise<ActionResult | null> {
    if (epoch !== this.epoch) return null;
    await this.beforeExecute();
    if (epoch !== this.epoch) return null;
    const controller = new AbortController();
    this.active = controller;
    const result: ActionResult = {
      requested: command.paths.length,
      completed: [],
      failed: [],
    };
    let processed = 0;

    for (const path of command.paths) {
      if (controller.signal.aborted || epoch !== this.epoch) return null;
      if (revisions.get(path) !== this.revision(path)) {
        processed += 1;
        command.onProgress?.(processed, result.requested);
        continue;
      }
      const current = this.current();
      if (
        !current ||
        current.reviewKey !== command.reviewKey ||
        current.generation !== command.generation
      ) {
        return null;
      }

      const update = await this.markFiles(
        current.snapshot,
        [path],
        command.viewed,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || epoch !== this.epoch) return null;
      if (!this.isCurrent(command)) return null;
      result.completed.push(...update.completed);
      result.failed.push(...update.failed);
      processed += 1;
      command.onProgress?.(processed, result.requested);
    }

    if (this.active === controller) this.active = null;
    return result;
  }

  private isCurrent(command: ViewedCommand): boolean {
    const current = this.current();
    return (
      current?.reviewKey === command.reviewKey &&
      current.generation === command.generation
    );
  }

  private revision(path: string): number {
    return this.revisions.get(path) ?? 0;
  }
}
