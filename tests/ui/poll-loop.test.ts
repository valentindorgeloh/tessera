/**
 * Poll loop of the change poller (src/components/shell/poll-loop.ts): one
 * timer and one request at a time, wake() never forks the loop, failures
 * back off, stop() ends it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPollLoop, type PollLoop } from "@/components/shell/poll-loop";

const INTERVAL = 5_000;
const BACKOFF = 30_000;

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
});
