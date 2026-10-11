/**
 * Poll loop behind ChangesPoller (src/components/shell/ChangesPoller.tsx):
 * one pending timer at a time and one request at a time. `wake()` (the tab
 * became visible) polls right away when the loop is idle; while a request is
 * in flight it is a no-op, because that request schedules the next poll when
 * it ends. A hidden/visible flicker can therefore never fork the loop into
 * parallel timers. Only the global timers are touched, so Vitest drives it
 * with fake timers.
 */

export type PollLoopOptions = {
  /** One poll. Resolves true when the request succeeded (keeps `intervalMs`); false or a throw backs off to `backoffMs`. */
  poll: () => Promise<boolean>;
  /** Whether a poll may run right now (the document is visible); otherwise the loop waits one interval and asks again. */
  isActive: () => boolean;
  intervalMs: number;
  backoffMs: number;
};

export type PollLoop = {
  /** Polls right away when idle; a no-op while a request is in flight. */
  wake: () => void;
  /** Cancels the pending timer; a request in flight finishes but schedules nothing more. */
  stop: () => void;
};

export function startPollLoop({ poll, isActive, intervalMs, backoffMs }: PollLoopOptions): PollLoop {
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = intervalMs;

  const schedule = (wait: number) => {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, wait);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    if (!isActive()) {
      schedule(delay);
      return;
    }
    inFlight = true;
    try {
      delay = (await poll()) ? intervalMs : backoffMs;
    } catch {
      delay = backoffMs;
    } finally {
      inFlight = false;
    }
    schedule(delay);
  };

  schedule(delay);

  return {
    wake: () => {
      if (stopped || inFlight) return;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      schedule(0);
    },
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
