import type { PageSnapshot } from '@diffseek/github/review-page/page-adapter';

import {
  type ActionResult,
  markViewed,
} from '@diffseek/github/review-page/viewed-actions';

export interface ViewedCommand {
  generation: number;
  onProgress?: (completed: number, requested: number) => void;
  paths: string[];
  reviewKey: string;
  viewed: boolean;
}

interface CurrentReviewState {
  generation: number;
  reviewKey: string;
  snapshot: SupportedSnapshot;
}

interface MarkAttempt {
  command: ViewedCommand;
  controller: AbortController;
  epoch: number;
  result: ActionResult;
  revisions: ReadonlyMap<string, number>;
}

type SupportedSnapshot = Extract<PageSnapshot, { supported: true }>;

interface ViewedActionExecutorOptions {
  beforeExecute?: () => Promise<void>;
  current: () => CurrentReviewState | null;
  markFiles?: typeof markViewed;
}

export class ViewedActionExecutor {
  private active: AbortController | null = null;
  private readonly beforeExecute: () => Promise<void>;
  private readonly current: () => CurrentReviewState | null;
  private epoch = 0;
  private readonly markFiles: typeof markViewed;
  private readonly revisions = new Map<string, number>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: ViewedActionExecutorOptions) {
    this.current = options.current;
    this.beforeExecute = options.beforeExecute ?? ((): Promise<void> => Promise.resolve());
    this.markFiles = options.markFiles ?? markViewed;
  }

  cancel(): void {
    this.epoch += 1;
    this.active?.abort();
    this.active = null;
  }

  enqueue(command: ViewedCommand): Promise<ActionResult | null> {
    const epoch = this.epoch;
    const revisions = new Map(
      command.paths.map((path) => [path, this.revision(path)]),
    );
    const result = this.afterTail(command, epoch, revisions);
    this.tail = settleQuietly(result);
    return result;
  }

  invalidate(path: string): void {
    this.revisions.set(path, this.revision(path) + 1);
  }

  private advance(command: ViewedCommand, requested: number, processed: number): number {
    const next = processed + 1;
    command.onProgress?.(next, requested);
    return next;
  }

  private async afterTail(
    command: ViewedCommand,
    epoch: number,
    revisions: ReadonlyMap<string, number>,
  ): Promise<ActionResult | null> {
    await this.tail;
    return this.execute(command, epoch, revisions);
  }

  private async execute(
    command: ViewedCommand,
    epoch: number,
    revisions: ReadonlyMap<string, number>,
  ): Promise<ActionResult | null> {
    if (!(await this.ready(epoch))) return null;
    const controller = new AbortController();
    this.active = controller;
    const result = await this.markEach({
      command,
      controller,
      epoch,
      result: {
        completed: [],
        failed: [],
        requested: command.paths.length,
      },
      revisions,
    });
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

  private async markEach(attempt: MarkAttempt): Promise<ActionResult | null> {
    let processed = 0;
    for (const path of attempt.command.paths) {
      const next = await this.markOne(attempt, path, processed);
      if (next === null) return null;
      processed = next;
    }
    return attempt.result;
  }

  private async markOne(
    attempt: MarkAttempt,
    path: string,
    processed: number,
  ): Promise<null | number> {
    if (this.stopped(attempt.controller, attempt.epoch)) return null;
    if (attempt.revisions.get(path) !== this.revision(path)) {
      return this.advance(attempt.command, attempt.result.requested, processed);
    }
    const current = this.current();
    if (
      current?.reviewKey !== attempt.command.reviewKey ||
      current.generation !== attempt.command.generation
    ) {
      return null;
    }
    const update = await this.markFiles(
      current.snapshot,
      [path],
      { signal: attempt.controller.signal, viewed: attempt.command.viewed },
    );
    if (this.stopped(attempt.controller, attempt.epoch) || !this.isCurrent(attempt.command)) {
      return null;
    }
    attempt.result.completed.push(...update.completed);
    attempt.result.failed.push(...update.failed);
    return this.advance(attempt.command, attempt.result.requested, processed);
  }

  private async ready(epoch: number): Promise<boolean> {
    if (epoch !== this.epoch) return false;
    await this.beforeExecute();
    return epoch === this.epoch;
  }

  private revision(path: string): number {
    return this.revisions.get(path) ?? 0;
  }

  private stopped(controller: AbortController, epoch: number): boolean {
    return controller.signal.aborted || epoch !== this.epoch;
  }
}

async function settleQuietly(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // The queue continues after a rejected command.
  }
}
