"use client";

import { useEffect, useRef } from "react";
import { refreshAction } from "@/app/actions/shell";
import { startPollLoop } from "./poll-loop";

/** Poll cadence while the tab is visible and the last request succeeded. */
export const POLL_INTERVAL_MS = 5_000;
/** Cadence after a failed request, until one succeeds again. */
export const POLL_BACKOFF_MS = 30_000;

type ChangesPayload = { changes: unknown[]; cursor: number };

function isChangesPayload(value: unknown): value is ChangesPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { changes?: unknown }).changes) &&
    typeof (value as { cursor?: unknown }).cursor === "number"
  );
}

/**
 * Watches for writes by other actors (docs/contracts/ui.md "External writes").
 * Every 5 s while the document is visible it asks `/api/changes?since=<cursor>`
 * for activity the user did not cause; when some arrives it moves the cursor
 * and calls `refreshAction()` so the open screen re-renders. A failed request
 * backs the cadence off to 30 s until the next success. The loop itself lives
 * in ./poll-loop.ts: one timer and one request at a time, so a tab that is
 * hidden and shown while a request is awaiting never ends up polled twice.
 * Renders nothing and only runs inside effects, never during server rendering.
 */
export function ChangesPoller({ initialCursor }: { initialCursor: number }) {
  const cursorRef = useRef(initialCursor);

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
        if (payload.changes.length > 0) {
          cursorRef.current = payload.cursor;
          await refreshAction();
        }
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
