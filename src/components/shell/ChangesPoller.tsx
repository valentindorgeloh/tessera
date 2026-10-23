"use client";

import { useEffect, useRef } from "react";
import { refreshAction } from "@/app/actions/shell";
import { nextPollState, POLL_BACKOFF_MS, POLL_INTERVAL_MS, startPollLoop, type PollPayload } from "./poll-loop";

type ChangesPayload = PollPayload;

function isChangesPayload(value: unknown): value is ChangesPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { changes?: unknown }).changes) &&
    typeof (value as { cursor?: unknown }).cursor === "number" &&
    ["undefined", "number"].includes(typeof (value as { unread_notifications?: unknown }).unread_notifications)
  );
}

/**
 * Watches for writes by other actors (docs/contracts/ui.md "External writes").
 * Every 4 s while the document is visible (fixed rate, so an external write
 * shows within the contract's 5 s including the refresh; see
 * `POLL_INTERVAL_MS`) it asks `/api/changes?since=<cursor>` for activity the
 * user did not cause; when some arrives it moves the cursor and calls
 * `refreshAction()` so the open screen re-renders. The same response carries
 * the user's unread notification count; when it differs from the last value
 * the screen refreshes too (decision 59), so a snooze wake-up updates the
 * sidebar badge with no new activity. A failed request backs the
 * cadence off to 30 s until the next success. The loop itself lives in
 * ./poll-loop.ts: one timer and one request at a time, so a tab that is hidden
 * and shown while a request is awaiting never ends up polled twice.
 * Renders nothing and only runs inside effects, never during server rendering.
 */
export function ChangesPoller({ initialCursor, initialUnread }: { initialCursor: number; initialUnread: number }) {
  const cursorRef = useRef(initialCursor);
  const unreadRef = useRef<number | null>(initialUnread);

  // A refresh (or the user's own read or archive) brings a new server count: adopt it so the next poll does not refresh a second time.
  useEffect(() => {
    unreadRef.current = initialUnread;
  }, [initialUnread]);

  useEffect(() => {
    const loop = startPollLoop({
      intervalMs: POLL_INTERVAL_MS,
      backoffMs: POLL_BACKOFF_MS,
      isActive: () => document.visibilityState === "visible",
      poll: async () => {
        const response = await fetch(`/api/changes?since=${cursorRef.current}`, { cache: "no-store" });
        if (!response.ok) return false;
        const payload: unknown = await response.json();
        if (!isChangesPayload(payload)) return false;
        const next = nextPollState({ cursor: cursorRef.current, unread: unreadRef.current }, payload);
        cursorRef.current = next.cursor;
        unreadRef.current = next.unread;
        if (next.refresh) await refreshAction();
        return true;
      },
    });
    const onVisibilityChange = () => {
      // Coming back to the tab: poll right away instead of waiting out the timer.
      if (document.visibilityState === "visible") loop.wake();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      loop.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
