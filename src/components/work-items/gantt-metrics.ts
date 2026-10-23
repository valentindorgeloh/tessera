/**
 * Pixel metrics of the gantt, for the dependency connector layer (decisions
 * 90 and 92). The layer is drawn in CSS pixels, not in a scaled viewBox, so an
 * arrowhead keeps its shape and the paths meet the bars at any zoom and on a
 * 44px touch row. The day column is measured from the first header day, the
 * row from the first rendered row (a touch screen has taller rows), and the
 * bar inset from `--tessera-gantt-inset` in gantt.css. A ResizeObserver on the
 * gantt's root re-reads them when a zoom, a breakpoint or the row count
 * changes. `readGanttMetrics` and `parseCssLength` are the pure/DOM parts.
 */
import { useEffect, useState, type RefObject } from "react";
import type { ConnectorScale } from "./gantt-scale";

export type GanttMetrics = ConnectorScale;

/** A resolved CSS length (`4px`, `0.25rem`) in pixels; 0 when it is neither. */
export function parseCssLength(value: string, rootFontSize = 16): number {
  const match = /^\s*(-?\d*\.?\d+)(px|rem)?\s*$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * rootFontSize : amount;
}

/** Day column, row height and bar inset of the gantt rooted at `root`; null while it has no layout (hidden route, first paint). */
export function readGanttMetrics(root: HTMLElement): GanttMetrics | null {
  const day = root.querySelector<HTMLElement>(".tessera-gantt-head-day")?.getBoundingClientRect().width ?? 0;
  const row = root.querySelector<HTMLElement>(".tessera-gantt-row")?.getBoundingClientRect().height ?? 0;
  if (day <= 0 || row <= 0) return null;
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const inset = parseCssLength(getComputedStyle(root).getPropertyValue("--tessera-gantt-inset"), rootFont);
  return { day, row, inset };
}

function same(a: GanttMetrics | null, b: GanttMetrics): boolean {
  return a !== null && a.day === b.day && a.row === b.row && a.inset === b.inset;
}

/** The measured metrics of the gantt on `rootRef`, kept up to date while `active`; null until the first measurement. */
export function useGanttMetrics(rootRef: RefObject<HTMLElement | null>, active: boolean): GanttMetrics | null {
  const [metrics, setMetrics] = useState<GanttMetrics | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root || typeof ResizeObserver !== "function") return;
    // The observer reports once when it starts, so the first measurement lands here without a synchronous setState.
    const observer = new ResizeObserver(() => {
      const next = readGanttMetrics(root);
      if (next) setMetrics((current) => (same(current, next) ? current : next));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef, active]);
  return metrics;
}
