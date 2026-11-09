/**
 * Calendar grid (week, month and quarter). Week columns follow `weekStartsOn`
 * (0 Sunday, 1 Monday, ..., 6 Saturday). Dates stay `YYYY-MM-DD`; no clock is read.
 */
import { addDays } from "@/lib/tessera/core/time";

export type CalendarView = "week" | "month" | "quarter";
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The workspace default (`workspace_settings.week_start`): Monday. */
export const WEEK_STARTS_ON: WeekStart = 1;

/** A stored `week_start` (any integer 0..6) as a WeekStart; anything else falls back to Monday. */
export function toWeekStart(value: number | undefined): WeekStart {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 6 ? (value as WeekStart) : WEEK_STARTS_ON;
}

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

/** The first day of the calendar quarter holding `date` (Q1 is Jan–Mar): `YYYY-01|04|07|10-01`. */
export function quarterStart(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${year}-${pad(Math.floor((month - 1) / 3) * 3 + 1)}-01`;
}

/** The last day of the calendar quarter holding `date`. */
export function quarterEnd(date: string): string {
  const [year, month] = quarterStart(date).split("-").map(Number);
  return monthEnd(`${year}-${pad(month + 2)}-01`);
}

/**
 * Move the anchor by one week, month or quarter. A month lands on the first
 * of that month, a quarter on the first day of that quarter.
 */
export function shiftPeriod(anchor: string, view: CalendarView, delta: -1 | 1): string {
  if (view === "week") return addDays(anchor, delta * 7);
  const from = view === "quarter" ? quarterStart(anchor) : anchor;
  const [year, month] = from.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta * (view === "quarter" ? 3 : 1), 1));
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
  if (view === "quarter") {
    const start = quarterStart(anchor);
    const quarter = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
    return `Q${quarter} ${start.slice(0, 4)} (${formatUtc(start, { month: "short" })} – ${formatUtc(quarterEnd(anchor), { month: "short" })})`;
  }
  return formatUtc(monthStart(anchor), { month: "long", year: "numeric" });
}

export function monthLabel(date: string): string {
  return formatUtc(date, { month: "short", year: "numeric" });
}

/** Short label for a gantt week band (the week's first day). */
export function weekBandLabel(date: string): string {
  return formatUtc(date, { month: "short", day: "numeric" });
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

/** First and last day of the period holding the anchor (week: the anchor's week). */
function periodBounds(anchor: string, view: CalendarView, weekStartsOn: WeekStart): [string, string] {
  if (view === "week") {
    const start = startOfWeek(anchor, weekStartsOn);
    return [start, addDays(start, 6)];
  }
  if (view === "quarter") return [quarterStart(anchor), quarterEnd(anchor)];
  return [monthStart(anchor), monthEnd(anchor)];
}

/**
 * Weeks covering the anchor. A month is the whole weeks that touch it
 * (5 or 6 rows). A quarter is the whole weeks that touch it (13 or 14 rows).
 * A week is one row. `showWeekends: false` drops Saturday and Sunday from
 * each row.
 */
export function calendarWeeks(anchor: string, view: CalendarView, weekStartsOn: WeekStart, showWeekends: boolean): string[][] {
  const [first, last] = periodBounds(anchor, view, weekStartsOn);
  const start = startOfWeek(first, weekStartsOn);
  const end = addDays(startOfWeek(last, weekStartsOn), 6);
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

/** Muted days (decision 139): outside the anchor's quarter in a quarter; outside the anchor's month in a week or a month, as before. */
export function isOutsidePeriod(date: string, anchor: string, view: CalendarView): boolean {
  return view === "quarter" ? quarterStart(date) !== quarterStart(anchor) : isOutsideMonth(date, anchor);
}

/** A cell's day label: "Nov 1" on the first of a month in a quarter, else the day number. */
export function dayLabel(date: string, view: CalendarView): string {
  if (view === "quarter" && date.slice(8, 10) === "01") return formatUtc(date, { month: "short", day: "numeric" });
  return String(Number(date.slice(8, 10)));
}

/** Items a cell shows before "+N more" (decision 139): week and month 4, as before; quarter 2. */
export const CELL_ITEM_LIMIT: Readonly<Record<CalendarView, number>> = { week: 4, month: 4, quarter: 2 };

/** A quarter calendar whose content box is narrower than this shows only a "+N" count per cell (the root's inline padding is not counted). */
export const QUARTER_NARROW_PX = 600;

/** Items a cell shows: none in a narrow quarter (the count only), else `CELL_ITEM_LIMIT`. */
export function cellItemLimit(view: CalendarView, isNarrow: boolean): number {
  return view === "quarter" && isNarrow ? 0 : CELL_ITEM_LIMIT[view];
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

/** A day cell narrower than this (a phone, a side peek) opens quick add in a popover: an inline input in it would be a few pixels wide. */
export const NARROW_CELL_PX = 120;

/** Whether quick add for a cell `width` px wide opens in a popover (a cell that is not measured yet counts as narrow). */
export function opensQuickAddInPopover(width: number | undefined): boolean {
  return width === undefined || width < NARROW_CELL_PX;
}
