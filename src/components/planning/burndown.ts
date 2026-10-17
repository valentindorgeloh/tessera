/**
 * Burndown and burnup model (docs/contracts/ui.md "Burndown and burnup
 * chart"). Pure, no React, tested in tests/ui/burndown.test.ts. The engine
 * stores only the pending amount per day (`completion_chart`); the ideal line,
 * the burnup series, the today marker and the pace are derived here from that
 * series, the dates and the scope (total minus cancelled). There is no per-day
 * scope series, so the burnup's scope is today's scope drawn flat (P9 adds the
 * series); on a frozen cycle the scope is the snapshot's.
 */
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { addDays, daysBetween } from "@/lib/tessera/core/time";
import type { CycleProgress, CycleStatus, ProgressMode } from "@/lib/tessera/types";

export type ChartKind = "burndown" | "burnup";
export type ChartRow = { date: string; actual: number | null; ideal: number };
export type ChartEmpty = "draft" | "upcoming" | "no_items";
export type ChartModel = {
  kind: ChartKind;
  /** progress.chart_mode ?? "issues", never the requested unit blindly. */
  unit: ProgressMode;
  /** Every day start_date..end_date inclusive. */
  rows: ChartRow[];
  /** total − cancelled in the unit (points.* in points). */
  scope: number;
  /** today when start_date ≤ today ≤ end_date, else null. */
  today: string | null;
  /** At min(today, end_date), in the chart's kind (pending for a burndown, done for a burnup). */
  current: { actual: number; ideal: number } | null;
  /** Pending at min(today, end_date) against the ideal pending there; `delta` = actual − ideal (positive = behind). */
  pace: { status: "on_track" | "ahead" | "behind"; delta: number } | null;
  empty: ChartEmpty | null;
};

export type BuildChartInput = {
  start_date: string | null;
  end_date: string | null;
  status: CycleStatus;
  today: string;
  progress: CycleProgress;
  kind: ChartKind;
};

/** Rounds to one decimal at most, dropping a trailing ".0": 4 → "4", 4.25 → "4.3". */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "1 work item", "3 work items", "1 point", "4.5 points" (one decimal at most). */
export function formatAmount(value: number, unit: ProgressMode): string {
  const text = formatNumber(value);
  const one = text === "1";
  if (unit === "points") return `${text} ${one ? "point" : "points"}`;
  return `${text} ${one ? "work item" : "work items"}`;
}

/** The unit in use: the stored preference only when the cycle has points progress, else work items. */
export function effectiveUnit(preferred: ProgressMode, hasPoints: boolean): ProgressMode {
  return hasPoints ? preferred : "issues";
}

/** Ideal pending per day for `days` days: a straight line from `scope` to 0; one day → [0]. */
export function idealSeries(scope: number, days: number): number[] {
  if (days <= 0) return [];
  if (days === 1) return [0];
  return Array.from({ length: days }, (_, i) => (scope * (days - 1 - i)) / (days - 1));
}

/** On track within max(1, 5% of scope); behind when more is pending than the ideal, ahead when less. */
export function paceOf(actualPending: number, idealPending: number, scope: number): ChartModel["pace"] {
  const delta = actualPending - idealPending;
  const tolerance = Math.max(1, scope * 0.05);
  if (Math.abs(delta) <= tolerance) return { status: "on_track", delta };
  return { status: delta > 0 ? "behind" : "ahead", delta };
}

function scopeOf(progress: CycleProgress, unit: ProgressMode): number {
  if (unit === "points" && progress.points) return Math.max(0, progress.points.total - progress.points.cancelled);
  return Math.max(0, progress.total - progress.cancelled);
}

function daysOf(start: string, end: string): string[] {
  const count = daysBetween(start, end) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(start, i));
}

export function buildChartModel(input: BuildChartInput): ChartModel {
  const { start_date, end_date, status, today, progress, kind } = input;
  const unit: ProgressMode = progress.chart_mode ?? "issues";
  const scope = scopeOf(progress, unit);
  const base = { kind, unit, scope };
  if (start_date === null || end_date === null) {
    return { ...base, rows: [], today: null, current: null, pace: null, empty: "draft" };
  }
  const days = daysOf(start_date, end_date);
  const ideal = idealSeries(scope, days.length);
  const lastDay = today < end_date ? today : end_date;
  const pendingOn = (date: string): number | null => {
    if (date > lastDay) return null;
    const value = progress.completion_chart[date];
    return typeof value === "number" ? value : null;
  };
  const rows: ChartRow[] = days.map((date, i) => {
    const pending = pendingOn(date);
    if (kind === "burndown") return { date, actual: pending, ideal: ideal[i] };
    return { date, actual: pending === null ? null : Math.max(0, scope - pending), ideal: scope - ideal[i] };
  });
  const todayInRange = start_date <= today && today <= end_date ? today : null;
  const empty: ChartEmpty | null = status === "upcoming" || today < start_date ? "upcoming" : scope === 0 ? "no_items" : null;
  const index = lastDay >= start_date ? days.indexOf(lastDay) : -1;
  const pending = index >= 0 ? pendingOn(lastDay) : null;
  if (index < 0 || pending === null || empty !== null) {
    return { ...base, rows, today: todayInRange, current: null, pace: null, empty };
  }
  const row = rows[index];
  return {
    ...base,
    rows,
    today: todayInRange,
    current: { actual: row.actual ?? 0, ideal: row.ideal },
    pace: paceOf(pending, ideal[index], scope),
    empty,
  };
}

const KIND_LABEL: Record<ChartKind, string> = { burndown: "Burndown", burnup: "Burnup" };

/** The pace as a sentence: "On track.", "Behind by 1.", "Ahead by 2.5." */
export function paceSentence(pace: NonNullable<ChartModel["pace"]>): string {
  if (pace.status === "on_track") return "On track.";
  return `${pace.status === "behind" ? "Behind" : "Ahead"} by ${formatNumber(Math.abs(pace.delta))}.`;
}

/** Recharts `ReferenceLine` label positions the today marker uses. */
export type TodayLabelPosition = "insideTopLeft" | "insideTopRight";

/**
 * Which side of the today marker its "Today" label takes: right of the line
 * in the first half of the cycle, where a label to the left would run over the
 * y-axis and be clipped (today on the first day), and left of it from the
 * middle on, where a label to the right would leave the plot (the last day).
 */
export function todayLabelPosition(model: Pick<ChartModel, "rows" | "today">): TodayLabelPosition {
  if (model.today === null) return "insideTopRight";
  const index = model.rows.findIndex((row) => row.date === model.today);
  return index >= 0 && index < (model.rows.length - 1) / 2 ? "insideTopLeft" : "insideTopRight";
}

/** The day `current` describes: the last row with data, which is min(today, end_date). */
export function currentDate(model: ChartModel): string | null {
  if (model.current === null) return null;
  for (let i = model.rows.length - 1; i >= 0; i -= 1) {
    if (model.rows[i].actual !== null) return model.rows[i].date;
  }
  return null;
}

/**
 * One sentence for the chart's accessible name and the visible caption:
 * "Burndown of Sprint 1: 5 of 8 work items pending on Mar 9, ideal 4. Behind by 1."
 * The cycle name is optional (the model does not carry it); `today` decides which dates show their year.
 */
export function summarizeChart(model: ChartModel, today: string, cycleName?: string): string {
  const head = cycleName ? `${KIND_LABEL[model.kind]} of ${cycleName}` : KIND_LABEL[model.kind];
  if (model.empty === "draft") return `${head}: add dates to see the chart.`;
  if (model.empty === "upcoming") return model.rows.length > 0 ? `${head}: starts ${formatShortDate(model.rows[0].date, today)}.` : `${head}: not started.`;
  if (model.empty === "no_items") return `${head}: add work items to see the chart.`;
  const asOf = currentDate(model);
  if (model.current === null || asOf === null) return `${head}: no data yet.`;
  const verb = model.kind === "burndown" ? "pending" : "done";
  const amount = `${formatNumber(model.current.actual)} of ${formatAmount(model.scope, model.unit)} ${verb}`;
  const pace = model.pace ? ` ${paceSentence(model.pace)}` : "";
  return `${head}: ${amount} on ${formatShortDate(asOf, today)}, ideal ${formatNumber(model.current.ideal)}.${pace}`;
}
