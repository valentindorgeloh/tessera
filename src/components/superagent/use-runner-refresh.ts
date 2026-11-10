"use client";

/**
 * Reloads the open Superagent screen on a timer (decision 145; decision 146):
 * while not paused, every `intervalMs` it asks the server to refresh, inside a
 * transition, when the tab is visible. The screens pause it while a dialog is
 * open so a reload never lands under one. A refresh that fails (Tessera's
 * server restarting, as during `live:update`) is dropped and the next tick
 * tries again; thrown inside the transition it would replace the screen with
 * the error boundary.
 */
import { useEffect, useTransition } from "react";
import { superagentRefreshAction } from "@/app/actions/superagent";

export function useRunnerRefresh(intervalMs: number, isPaused: boolean): void {
  const [, startPoll] = useTransition();
  useEffect(() => {
    if (isPaused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      startPoll(async () => {
        await superagentRefreshAction().catch(() => undefined);
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, isPaused, startPoll]);
}
