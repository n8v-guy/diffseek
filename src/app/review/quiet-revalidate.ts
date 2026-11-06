/** How long the page must stay quiet before one reread of a due metadata entry. */
export const metadataQuietMs = 3_000;

export type QuietClock = {
  arm(run: () => void): void;
  cancel(): void;
};

export function browserQuiet(view: Window, delayMs: number): QuietClock {
  let timer: number | undefined;
  return {
    arm(run) {
      this.cancel();
      timer = view.setTimeout(run, delayMs);
    },
    cancel() {
      if (timer === undefined) return;
      view.clearTimeout(timer);
      timer = undefined;
    },
  };
}

export type QuietRevalidate = {
  /** A native page change. Resets the quiet wait, and may arm another attempt. */
  activity(): void;
  /** Cached metadata was served past its TTL. */
  noteStale(): void;
  /** The cached metadata is fresh. */
  noteFresh(): void;
  /** A reread finished. A failure stays due until the page changes again. */
  noteAttempt(stillDue: boolean): void;
  cancel(): void;
};

/**
 * One reread after the page has been quiet. It does not poll while the page
 * stays still, including after a failed reread.
 */
export function quietRevalidate(
  clock: QuietClock,
  onQuiet: () => void,
): QuietRevalidate {
  let due = false;
  let held = false;
  let armed = false;
  const arm = (): void => {
    armed = true;
    clock.arm(() => {
      armed = false;
      held = true;
      if (!due) return;
      onQuiet();
    });
  };
  return {
    activity() {
      if (!due) return;
      held = false;
      arm();
    },
    noteStale() {
      due = true;
      if (held || armed) return;
      arm();
    },
    noteFresh() {
      due = false;
      held = false;
      armed = false;
      clock.cancel();
    },
    noteAttempt(stillDue) {
      due = stillDue;
      held = true;
      armed = false;
      clock.cancel();
    },
    cancel() {
      due = false;
      held = false;
      armed = false;
      clock.cancel();
    },
  };
}

const idleClock: QuietClock = {
  arm() {},
  cancel() {},
};

/** The review clock: an injected clock, the browser timer, or a no-op without a window. */
export function sessionQuiet(
  root: Document,
  clock: QuietClock | undefined,
  onQuiet: () => void,
): QuietRevalidate {
  const view = root.defaultView;
  return quietRevalidate(
    clock ?? (view ? browserQuiet(view, metadataQuietMs) : idleClock),
    onQuiet,
  );
}
