"use client";

/**
 * Horizontal day drag for a gantt bar. The pointer reports a pixel delta;
 * the layout turns that into a whole-day move through `dayDelta` and commits
 * once, on pointer-up. Escape and pointercancel abandon the drag.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { dayDelta, type BarDragMode } from "@/components/work-items/date-span";

const THRESHOLD = 5;
const DRAGGING_CLASS = "tessera-dragging";

export type TimelinePreview = {
  id: string;
  mode: BarDragMode;
  delta: number;
};

type Session = {
  id: string;
  mode: BarDragMode;
  pointerId: number;
  startX: number;
  delta: number;
  moved: boolean;
};

export type UseTimelineDragOptions = {
  /** Rendered width of one day column, measured from the grid. */
  dayWidth: () => number;
  onCommit: (id: string, mode: BarDragMode, delta: number) => void;
  enabled?: boolean;
};

export function useTimelineDrag({ dayWidth, onCommit, enabled = true }: UseTimelineDragOptions) {
  const optionsRef = useRef({ dayWidth, onCommit, enabled });
  useEffect(() => {
    optionsRef.current = { dayWidth, onCommit, enabled };
  });

  const [preview, setPreview] = useState<TimelinePreview | null>(null);
  const session = useRef<Session | null>(null);
  const suppressClick = useRef(false);

  const clearBody = () => document.body.classList.remove(DRAGGING_CLASS);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = session.current;
      if (!active || event.pointerId !== active.pointerId) return;
      const dx = event.clientX - active.startX;
      if (!active.moved && Math.abs(dx) < THRESHOLD) return;
      if (!active.moved) {
        active.moved = true;
        document.body.classList.add(DRAGGING_CLASS);
      }
      const delta = dayDelta(dx, optionsRef.current.dayWidth());
      if (delta === active.delta) return;
      active.delta = delta;
      setPreview({ id: active.id, mode: active.mode, delta });
    };
    const finish = (commit: boolean) => (event: PointerEvent) => {
      const active = session.current;
      if (!active || event.pointerId !== active.pointerId) return;
      session.current = null;
      clearBody();
      if (active.moved) {
        suppressClick.current = true;
        if (commit && active.delta !== 0) optionsRef.current.onCommit(active.id, active.mode, active.delta);
      }
      setPreview(null);
    };
    const up = finish(true);
    const cancel = finish(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || session.current === null) return;
      session.current = null;
      clearBody();
      setPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
      clearBody();
    };
  }, []);

  const onPointerDown = useCallback((id: string, mode: BarDragMode, event: ReactPointerEvent<HTMLElement>) => {
    if (!optionsRef.current.enabled || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    session.current = { id, mode, pointerId: event.pointerId, startX: event.clientX, delta: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { preview, onPointerDown, onClickCapture };
}
