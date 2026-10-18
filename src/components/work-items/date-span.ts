/**
 * Day-delta and clamp rules for gantt bars and calendar drops.
 * Dates are `YYYY-MM-DD`. A bar is inclusive: one date is a one-day bar,
 * and a drag never leaves `start_date` after `target_date`.
 */
import { addDays, compareDates, daysBetween } from "@/lib/tessera/core/time";

export type DateEnds = {
  start_date: string | null;
  target_date: string | null;
};

/** Keys a drag writes. A bar move includes every date the item already has. */
export type DatePatch = {
  start_date?: string;
  target_date?: string;
};

export type BarDragMode = "move" | "start" | "end";

export type BarSpan = {
  start: string;
  end: string;
  openStart: boolean;
  openEnd: boolean;
};

/** Inclusive span. One date is a one-day bar with the missing end left open. */
export function barSpan(ends: DateEnds): BarSpan | null {
  const { start_date, target_date } = ends;
  if (start_date && target_date && compareDates(start_date, target_date) <= 0) {
    return { start: start_date, end: target_date, openStart: false, openEnd: false };
  }
  if (target_date && !start_date) return { start: target_date, end: target_date, openStart: true, openEnd: false };
  if (start_date && !target_date) return { start: start_date, end: start_date, openStart: false, openEnd: true };
  return null;
}

/** `round(dx / dayWidth)`. A non-positive or non-finite width yields 0. */
export function dayDelta(dx: number, dayWidth: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dayWidth) || dayWidth <= 0) return 0;
  return Math.round(dx / dayWidth);
}

function clampStart(next: string, target: string | null): string {
  if (target !== null && compareDates(next, target) > 0) return target;
  return next;
}

function clampEnd(next: string, start: string | null): string {
  if (start !== null && compareDates(next, start) < 0) return start;
  return next;
}

/**
 * Apply a whole-day delta.
 * `move` shifts every date the item has by the same amount, so a bar that
 * has both dates writes both in one patch. `start` and `end` write only
 * that end, clamped so the start never passes the target. A missing end
 * is created from the one-day bar. Zero, a non-integer, or a no-op returns null.
 */
export function applyDayDelta(ends: DateEnds, mode: BarDragMode, delta: number): DatePatch | null {
  if (!Number.isInteger(delta) || delta === 0) return null;
  const { start_date, target_date } = ends;

  if (mode === "move") {
    if (start_date !== null && target_date !== null && compareDates(start_date, target_date) > 0) return null;
    const patch: DatePatch = {};
    if (start_date !== null) patch.start_date = addDays(start_date, delta);
    if (target_date !== null) patch.target_date = addDays(target_date, delta);
    return start_date === null && target_date === null ? null : patch;
  }

  if (mode === "start") {
    const anchor = start_date ?? target_date;
    if (anchor === null) return null;
    const next = clampStart(addDays(anchor, delta), target_date);
    if (next === start_date) return null;
    return { start_date: next };
  }

  const anchor = target_date ?? start_date;
  if (anchor === null) return null;
  const next = clampEnd(addDays(anchor, delta), start_date);
  if (next === target_date) return null;
  return { target_date: next };
}

/** Dates drawn while a drag preview is in progress. */
export function previewEnds(ends: DateEnds, mode: BarDragMode, delta: number): DateEnds {
  const patch = applyDayDelta(ends, mode, delta);
  if (!patch) return ends;
  return {
    start_date: patch.start_date ?? ends.start_date,
    target_date: patch.target_date ?? ends.target_date,
  };
}

/** Click on an empty gantt cell: both dates land on that day. */
export function scheduleOnDay(date: string): DatePatch {
  return { start_date: date, target_date: date };
}

/**
 * Drop a calendar item on `toDate`. Sets `target_date` and, when the item
 * already has a start, shifts that start by the same number of days.
 * The same day is a no-op. A target that would land before the start pulls
 * the start with it so the pair stays ordered.
 */
export function calendarDropPatch(ends: DateEnds, toDate: string): DatePatch | null {
  if (ends.target_date === toDate) return null;
  if (ends.target_date === null) {
    if (ends.start_date !== null && compareDates(ends.start_date, toDate) > 0) {
      return { start_date: toDate, target_date: toDate };
    }
    return { target_date: toDate };
  }
  const delta = daysBetween(ends.target_date, toDate);
  const patch: DatePatch = { target_date: toDate };
  if (ends.start_date !== null) patch.start_date = addDays(ends.start_date, delta);
  return patch;
}

/** Column offset and inclusive length of a bar inside a range that starts on `rangeStart`. */
export function barPlacement(ends: DateEnds, rangeStart: string): { offset: number; span: number; openStart: boolean; openEnd: boolean } | null {
  const bar = barSpan(ends);
  if (!bar) return null;
  return {
    offset: daysBetween(rangeStart, bar.start),
    span: daysBetween(bar.start, bar.end) + 1,
    openStart: bar.openStart,
    openEnd: bar.openEnd,
  };
}

/**
 * Visible gantt window: the loaded dates padded by 14 days, widened so it
 * always covers 45 days either side of `today`.
 */
export function timelineRange(dates: readonly (string | null)[], today: string): { start: string; end: string } {
  let start = today;
  let end = today;
  for (const date of dates) {
    if (date === null) continue;
    if (compareDates(date, start) < 0) start = date;
    if (compareDates(date, end) > 0) end = date;
  }
  start = addDays(start, -14);
  end = addDays(end, 14);
  const minStart = addDays(today, -45);
  const minEnd = addDays(today, 45);
  if (compareDates(start, minStart) > 0) start = minStart;
  if (compareDates(end, minEnd) < 0) end = minEnd;
  return { start, end };
}

/** Inclusive list of dates from `start` through `end`. */
export function eachDay(start: string, end: string): string[] {
  const count = daysBetween(start, end);
  const days: string[] = [];
  for (let index = 0; index <= count; index += 1) days.push(addDays(start, index));
  return days;
}
