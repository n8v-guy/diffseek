import { describe, expect, it, vi } from 'vitest';

import {
  browserQuiet,
  metadataQuietMs,
  quietRevalidate,
  type QuietClock,
} from './quiet-revalidate';

function manualClock(): QuietClock & { fire: () => void; armed: () => boolean } {
  let run: (() => void) | undefined;
  return {
    arm(next) {
      run = next;
    },
    cancel() {
      run = undefined;
    },
    fire() {
      const current = run;
      run = undefined;
      current?.();
    },
    armed: () => run !== undefined,
  };
}

describe('quiet metadata reread', () => {
  it('rereads a due entry once when the page goes quiet', () => {
    const clock = manualClock();
    const onQuiet = vi.fn();
    const quiet = quietRevalidate(clock, onQuiet);

    quiet.noteStale();
    expect(clock.armed()).toBe(true);
    quiet.noteStale();
    clock.fire();

    expect(onQuiet).toHaveBeenCalledOnce();
    expect(clock.armed()).toBe(false);
    clock.fire();
    expect(onQuiet).toHaveBeenCalledOnce();
  });

  it('resets the wait on activity and does not poll after a failed reread', () => {
    const clock = manualClock();
    const onQuiet = vi.fn();
    const quiet = quietRevalidate(clock, onQuiet);
    quiet.noteStale();
    quiet.activity();
    clock.fire();
    expect(onQuiet).toHaveBeenCalledOnce();

    quiet.noteAttempt(true);
    expect(clock.armed()).toBe(false);
    clock.fire();
    expect(onQuiet).toHaveBeenCalledOnce();

    quiet.activity();
    clock.fire();
    expect(onQuiet).toHaveBeenCalledTimes(2);
  });

  it('drops the wait when the entry is fresh or the session stops', () => {
    const clock = manualClock();
    const quiet = quietRevalidate(clock, vi.fn());
    quiet.noteStale();
    quiet.noteFresh();
    expect(clock.armed()).toBe(false);
    quiet.activity();
    expect(clock.armed()).toBe(false);

    quiet.noteStale();
    quiet.cancel();
    expect(clock.armed()).toBe(false);
    clock.fire();
  });

  it('arms the browser timer for the quiet period and replaces it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const run = vi.fn();
      const clock = browserQuiet(window, metadataQuietMs);
      clock.arm(run);
      vi.advanceTimersByTime(metadataQuietMs - 1);
      expect(run).not.toHaveBeenCalled();
      clock.arm(run);
      vi.advanceTimersByTime(metadataQuietMs);
      expect(run).toHaveBeenCalledOnce();
      clock.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
