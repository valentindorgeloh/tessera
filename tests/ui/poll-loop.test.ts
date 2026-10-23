/**
 * Poll loop of the change poller (src/components/shell/poll-loop.ts): one
 * timer and one request at a time, wake() never forks the loop, failures
 * back off, stop() ends it, the cadence is fixed-rate, and with the shipped
 * constants an external write shows within the contract's 5 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_WRITE_BOUND_MS,
  nextPollState,
  POLL_BACKOFF_MS,
  POLL_INTERVAL_MS,
  startPollLoop,
  type PollLoop,
} from "@/components/shell/poll-loop";

const INTERVAL = 5_000;
const BACKOFF = 30_000;

/** Waits on the (faked) timers, like a request or a refresh taking `ms`. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Deferred = { promise: Promise<boolean>; resolve: (value: boolean) => void; reject: (reason: unknown) => void };

function deferred(): Deferred {
  let resolve: (value: boolean) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("startPollLoop", () => {
  let loop: PollLoop | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    loop?.stop();
    loop = null;
    vi.useRealTimers();
  });

  it("polls once per interval while active", async () => {
    const poll = vi.fn(async () => true);
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    expect(poll).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("wake() during an in-flight request does not fork the loop", async () => {
    const pending = deferred();
    const poll = vi.fn(() => pending.promise);
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    // Hidden -> visible flicker while the request is still awaiting.
    loop.wake();
    loop.wake();
    expect(poll).toHaveBeenCalledTimes(1);
    pending.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    // Two more intervals produce exactly two more polls: a single loop.
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("wake() while idle polls right away and keeps a single timer", async () => {
    const poll = vi.fn(async () => true);
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(1_000);
    loop.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("backs off after a failed poll and recovers after a success", async () => {
    let fail = true;
    const poll = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return true;
    });
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(BACKOFF - INTERVAL);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("treats a false result as a failure", async () => {
    const poll = vi.fn(async () => false);
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BACKOFF - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("skips polls while inactive and resumes when active again", async () => {
    let active = false;
    const poll = vi.fn(async () => true);
    loop = startPollLoop({ poll, isActive: () => active, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(poll).toHaveBeenCalledTimes(0);
    active = true;
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels the pending timer and ignores a later wake()", async () => {
    const poll = vi.fn(async () => true);
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    loop.stop();
    loop.wake();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(poll).toHaveBeenCalledTimes(0);
  });

  it("a request finishing after stop() schedules nothing", async () => {
    const pending = deferred();
    const poll = vi.fn(() => pending.promise);
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    loop.stop();
    pending.resolve(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("keeps a fixed rate: a slow request does not push the next poll back", async () => {
    const t0 = Date.now();
    const starts: number[] = [];
    const poll = vi.fn(async () => {
      starts.push(Date.now() - t0);
      await sleep(300);
      return true;
    });
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL * 3 + 300);
    expect(starts).toEqual([INTERVAL, INTERVAL * 2, INTERVAL * 3]);
  });

  it("a request slower than the interval is followed right away by the next poll", async () => {
    const t0 = Date.now();
    const starts: number[] = [];
    const poll = vi.fn(async () => {
      starts.push(Date.now() - t0);
      if (starts.length === 1) await sleep(INTERVAL + 1_000);
      return true;
    });
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL * 4);
    // The slow request ends at INTERVAL * 2 + 1 000; a zero-delay timer runs
    // 1 ms later (Node clamps setTimeout(fn, 0) to 1 ms, and so do the fakes).
    expect(starts).toEqual([INTERVAL, INTERVAL * 2 + 1_001, INTERVAL * 3 + 1_001]);
  });

  it("backs off from the start of the failed request", async () => {
    const t0 = Date.now();
    const starts: number[] = [];
    const poll = vi.fn(async () => {
      starts.push(Date.now() - t0);
      await sleep(2_000);
      return starts.length > 1;
    });
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: INTERVAL, backoffMs: BACKOFF });
    await vi.advanceTimersByTimeAsync(INTERVAL + BACKOFF + INTERVAL);
    expect(starts).toEqual([INTERVAL, INTERVAL + BACKOFF, INTERVAL * 2 + BACKOFF]);
  });

  it("with the shipped constants, a write that lands right after a poll shows within the 5 s bound", async () => {
    // Worst case from the acceptance probe: the write lands just after a poll
    // read the feed, so only the next poll sees it. Model a request that reads
    // after 20 ms and answers after 50 ms, then a refresh round trip of 600 ms
    // (about 0.2 s measured in dev, so this leaves margin).
    const READ_MS = 20;
    const RESPONSE_MS = 50;
    const REFRESH_MS = 600;
    let feedSeq = 0;
    let cursor = 0;
    let writeAt: number | null = null;
    let shownAt: number | null = null;
    const poll = vi.fn(async () => {
      await sleep(READ_MS);
      const seen = feedSeq;
      if (writeAt === null) {
        // The external write lands 1 ms after this (first) read.
        setTimeout(() => {
          feedSeq += 1;
          writeAt = Date.now();
        }, 1);
      }
      await sleep(RESPONSE_MS - READ_MS);
      if (seen > cursor) {
        cursor = seen;
        await sleep(REFRESH_MS);
        shownAt = Date.now();
      }
      return true;
    });
    loop = startPollLoop({ poll, isActive: () => true, intervalMs: POLL_INTERVAL_MS, backoffMs: POLL_BACKOFF_MS });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(writeAt).not.toBeNull();
    expect(shownAt).not.toBeNull();
    // Both are set by the assertions above; the casts only narrow for the subtraction.
    const latency = (shownAt as unknown as number) - (writeAt as unknown as number);
    expect(latency).toBeGreaterThan(POLL_INTERVAL_MS);
    expect(latency).toBeLessThanOrEqual(EXTERNAL_WRITE_BOUND_MS);
  });
});

describe("nextPollState (decision 59)", () => {
  const prev = { cursor: 10, unread: 3 };

  it("refreshes and moves the cursor when changes arrived", () => {
    expect(nextPollState(prev, { changes: [{}], cursor: 12, unread_notifications: 3 })).toEqual({ cursor: 12, unread: 3, refresh: true });
  });

  it("refreshes on an unread change alone, with zero changes, and keeps the cursor", () => {
    expect(nextPollState(prev, { changes: [], cursor: 40, unread_notifications: 4 })).toEqual({ cursor: 10, unread: 4, refresh: true });
    expect(nextPollState(prev, { changes: [], cursor: 40, unread_notifications: 0 })).toEqual({ cursor: 10, unread: 0, refresh: true });
  });

  it("does nothing when neither changed", () => {
    expect(nextPollState(prev, { changes: [], cursor: 40, unread_notifications: 3 })).toEqual({ cursor: 10, unread: 3, refresh: false });
  });

  it("learns the first count without refreshing, and a payload without the field keeps the last one", () => {
    expect(nextPollState({ cursor: 10, unread: null }, { changes: [], cursor: 10, unread_notifications: 5 })).toEqual({ cursor: 10, unread: 5, refresh: false });
    expect(nextPollState(prev, { changes: [], cursor: 10 })).toEqual({ cursor: 10, unread: 3, refresh: false });
    expect(nextPollState(prev, { changes: [{}], cursor: 11 })).toEqual({ cursor: 11, unread: 3, refresh: true });
  });
});
