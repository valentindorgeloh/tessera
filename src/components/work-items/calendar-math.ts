/**
 * Calendar grid (month and week). Week columns follow `weekStartsOn`
 * (0 Sunday, 1 Monday). Dates stay `YYYY-MM-DD`; no clock is read.
 */
import { addDays } from "@/lib/tessera/core/time";

export type CalendarView = "month" | "week";
export type WeekStart = 0 | 1;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 0 Sunday … 6 Saturday, from the UTC calendar of a `YYYY-MM-DD` string. */
export function weekdayIndex(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const day = weekdayIndex(date);
  return day === 0 || day === 6;
}

/** Days from `date` back to the Saturday the weekend band starts on. Negative or zero. */
export function weekendShift(date: string): number {
  const day = weekdayIndex(date);
  const sinceSaturday = day === 6 ? 0 : day + 1;
  return -sinceSaturday;
}

export function startOfWeek(date: string, weekStartsOn: WeekStart): string {
  const delta = (weekdayIndex(date) - weekStartsOn + 7) % 7;
  return addDays(date, -delta);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
}

/** Move the anchor by one month or one week. A month lands on the first of that month. */
export function shiftPeriod(anchor: string, view: CalendarView, delta: -1 | 1): string {
  if (view === "week") return addDays(anchor, delta * 7);
  const [year, month] = anchor.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`;
}

function formatUtc(date: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

export function periodLabel(anchor: string, view: CalendarView, weekStartsOn: WeekStart): string {
  if (view === "week") {
    const start = startOfWeek(anchor, weekStartsOn);
    const end = addDays(start, 6);
    return `${formatUtc(start, { month: "short", day: "numeric" })} – ${formatUtc(end, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return formatUtc(monthStart(anchor), { month: "long", year: "numeric" });
}

export function monthLabel(date: string): string {
  return formatUtc(date, { month: "short", year: "numeric" });
}

export function weekdayLabels(weekStartsOn: WeekStart, showWeekends: boolean): string[] {
  const labels: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const day = (weekStartsOn + index) % 7;
    if (!showWeekends && (day === 0 || day === 6)) continue;
    labels.push(WEEKDAY_LABELS[day]);
  }
  return labels;
}

/**
 * Weeks covering the anchor. A month is the whole weeks that touch it
 * (5 or 6 rows). A week is one row. `showWeekends: false` drops Saturday
 * and Sunday from each row.
 */
export function calendarWeeks(anchor: string, view: CalendarView, weekStartsOn: WeekStart, showWeekends: boolean): string[][] {
  const start = view === "week" ? startOfWeek(anchor, weekStartsOn) : startOfWeek(monthStart(anchor), weekStartsOn);
  const end = view === "week" ? addDays(start, 6) : addDays(startOfWeek(monthEnd(anchor), weekStartsOn), 6);
  const weeks: string[][] = [];
  let cursor = start;
  while (cursor <= end) {
    const week: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const day = addDays(cursor, index);
      if (showWeekends || !isWeekend(day)) week.push(day);
    }
    if (week.length > 0) weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function isOutsideMonth(date: string, anchor: string): boolean {
  return date.slice(0, 7) !== monthStart(anchor).slice(0, 7);
}

/** Items sit on `target_date`. Order inside a day is the order of `items`. */
export function itemsByDay<T extends { target_date: string | null }>(items: readonly T[]): { byDay: Map<string, T[]>; unscheduled: T[] } {
  const byDay = new Map<string, T[]>();
  const unscheduled: T[] = [];
  for (const item of items) {
    if (item.target_date === null) {
      unscheduled.push(item);
      continue;
    }
    const list = byDay.get(item.target_date);
    if (list) list.push(item);
    else byDay.set(item.target_date, [item]);
  }
  return { byDay, unscheduled };
}
