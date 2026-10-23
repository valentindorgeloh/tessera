/**
 * Poll loop behind ChangesPoller (src/components/shell/ChangesPoller.tsx):
 * one pending timer at a time and one request at a time. `wake()` (the tab
 * became visible) polls right away when the loop is idle; while a request is
 * in flight it is a no-op, because that request schedules the next poll when
 * it ends. A hidden/visible flicker can therefore never fork the loop into
 * parallel timers.
 *
 * The cadence is fixed-rate: the next poll starts `intervalMs` after the
 * previous one *started*, so the time a request and the refresh it triggers
 * take never stretches the period (a poll slower than the interval is
 * followed right away by the next). Only the global timers and
 * `performance.now()` are touched, so Vitest drives it with fake timers.
 */

/**
 * docs/contracts/ui.md, P2b acceptance step 3: a write by another actor shows
 * in the open tab within 5 s.
 */
export const EXTERNAL_WRITE_BOUND_MS = 5_000;
/**
 * Poll cadence while the tab is visible and the last request succeeded. A
 * write that lands just after a poll read the feed is seen by the next poll,
 * which starts one interval after the previous one started; the remaining
 * second of the 5 s bound is for that request plus the `refreshAction()` round
 * trip it triggers (about 0.2 s measured in dev). With a 5 s interval the
 * worst case was 5 s plus that round trip.
 */
export const POLL_INTERVAL_MS = 4_000;
/** Cadence after a failed request, until one succeeds again. */
export const POLL_BACKOFF_MS = 30_000;

export type PollState = { cursor: number; unread: number | null };

export type PollPayload = { changes: readonly unknown[]; cursor: number; unread_notifications?: number };

/**
 * What one `/api/changes` payload does (decision 59). The cursor moves only
 * when changes arrived. The screen refreshes when there are changes, or when
 * the unread notification count differs from the last known one, so a snooze
 * wake-up updates the sidebar badge without any new activity. `prev.unread`
 * is null until a count is known, and a payload without the field keeps it.
 */
export function nextPollState(prev: PollState, payload: PollPayload): PollState & { refresh: boolean } {
  const hasChanges = payload.changes.length > 0;
  const count = typeof payload.unread_notifications === "number" ? payload.unread_notifications : null;
  const unread = count ?? prev.unread;
  const unreadChanged = count !== null && prev.unread !== null && count !== prev.unread;
  return { cursor: hasChanges ? payload.cursor : prev.cursor, unread, refresh: hasChanges || unreadChanged };
}

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
    const startedAt = performance.now();
    try {
      delay = (await poll()) ? intervalMs : backoffMs;
    } catch {
      delay = backoffMs;
    } finally {
      inFlight = false;
    }
    // Fixed rate: count the time this request took against the wait.
    schedule(Math.max(0, delay - (performance.now() - startedAt)));
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
