/**
 * Cycle formatting and menu rules (docs/contracts/ui.md "Cycles (E1)"). Pure
 * and directive-free so Server Components, client screens and Vitest
 * (tests/ui/cycle-format.test.ts) share one source: section grouping, the
 * date range and "days left" texts, the actions a cycle's menu offers, the
 * cycles whose days the date picker disables, the transfer targets and the
 * transfer dialog's text.
 */
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { daysBetween } from "@/lib/tessera/core/time";
import type { Cycle, CycleStatus } from "@/lib/tessera/types";

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  current: "Current",
  upcoming: "Upcoming",
  completed: "Completed",
  draft: "Draft",
};

/** StatusDot variants of the four statuses (a subset of Astryx's StatusDot variants). */
export type CycleStatusVariant = "accent" | "neutral" | "success";

const STATUS_VARIANT: Record<CycleStatus, CycleStatusVariant> = {
  current: "accent",
  upcoming: "neutral",
  completed: "success",
  draft: "neutral",
};

export function cycleStatusVariant(status: CycleStatus): CycleStatusVariant {
  return STATUS_VARIANT[status];
}

/** List sections in display order. */
export const CYCLE_SECTIONS: readonly CycleStatus[] = ["current", "upcoming", "completed", "draft"];

export type CycleSection<C extends Pick<Cycle, "status"> = Cycle> = { key: CycleStatus; label: string; cycles: C[] };

/** Cycles by status in the order Current, Upcoming, Completed, Draft, keeping the engine order inside a section; empty sections are left out. */
export function groupCycles<C extends Pick<Cycle, "status">>(cycles: readonly C[]): CycleSection<C>[] {
  return CYCLE_SECTIONS.map((key) => ({ key, label: CYCLE_STATUS_LABEL[key], cycles: cycles.filter((cycle) => cycle.status === key) })).filter(
    (section) => section.cycles.length > 0,
  );
}

/** "Mar 1 – Mar 14", or "No dates" for a draft; the year shows for a date outside `today`'s year. */
export function formatCycleRange(start: string | null, end: string | null, today: string): string {
  if (start === null || end === null) return "No dates";
  return `${formatShortDate(start, today)} – ${formatShortDate(end, today)}`;
}

/** "Ends today", "1 day left", "N days left" (counted from `today` to the end date); "Ended" once the end date has passed. */
export function daysLeftLabel(end: string, today: string): string {
  const days = daysBetween(today, end);
  if (days < 0) return "Ended";
  if (days === 0) return "Ends today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** The status `today` gives a cycle's dates (the engine's deriveCycleStatus, which client code cannot import). */
export function cycleStatusOn(range: Pick<Cycle, "start_date" | "end_date">, today: string): CycleStatus {
  if (range.start_date === null || range.end_date === null) return "draft";
  if (today < range.start_date) return "upcoming";
  if (today > range.end_date) return "completed";
  return "current";
}

export type CycleActionId = "edit" | "transfer" | "archive" | "restore" | "delete";

export type CycleAction = {
  id: CycleActionId;
  label: string;
  isDisabled?: boolean;
  /** Why the action is disabled. */
  description?: string;
  variant?: "default" | "destructive";
};

export const ARCHIVE_BLOCKED_REASON = "Cycles can be archived after their end date";
export const DELETE_BLOCKED_REASON = "Archive it first";

/**
 * The menu of one cycle. Edit for open cycles; Transfer for a completed cycle
 * with open items; Archive once the end date has passed (disabled with the
 * reason before); Restore for archived cycles; Delete always, disabled on a
 * completed cycle that is not archived (the engine answers LOCKED).
 */
export function cycleActions(cycle: Pick<Cycle, "start_date" | "end_date" | "archived_at" | "open_count">, today: string): CycleAction[] {
  const status = cycleStatusOn(cycle, today);
  const isArchived = cycle.archived_at !== null;
  const isCompleted = status === "completed";
  const actions: CycleAction[] = [];
  if (!isArchived && !isCompleted) actions.push({ id: "edit", label: "Edit…" });
  if (!isArchived && isCompleted && cycle.open_count > 0) actions.push({ id: "transfer", label: "Transfer open items…" });
  if (isArchived) {
    actions.push({ id: "restore", label: "Restore" });
  } else {
    actions.push(isCompleted ? { id: "archive", label: "Archive" } : { id: "archive", label: "Archive", isDisabled: true, description: ARCHIVE_BLOCKED_REASON });
  }
  const deleteBlocked = isCompleted && !isArchived;
  actions.push({
    id: "delete",
    label: "Delete…",
    variant: "destructive",
    ...(deleteBlocked ? { isDisabled: true, description: DELETE_BLOCKED_REASON } : {}),
  });
  return actions;
}

/** Every cycle except the one being edited: the date picker disables their days. */
export function overlapCandidates<C extends Pick<Cycle, "id">>(cycles: readonly C[], exceptId: string | null): C[] {
  return cycles.filter((cycle) => cycle.id !== exceptId);
}

/** Cycles that can receive a transfer: current, upcoming or draft, the source excluded (the bundle holds no archived cycles). */
export function transferTargets<C extends Pick<Cycle, "id" | "status">>(cycles: readonly C[], sourceId: string): C[] {
  return cycles.filter((cycle) => cycle.id !== sourceId && cycle.status !== "completed");
}

/**
 * The TransferDialog's text: what moves, then what happens to the progress.
 * The first transfer freezes it; the engine never replaces a frozen snapshot,
 * so a cycle frozen earlier (archived, then restored) keeps those numbers and
 * the text says so. `isFrozen` is `cycle.progress_snapshot !== null`.
 */
export function transferText(name: string, openCount: number, isFrozen: boolean): string {
  const items = openCount === 1 ? `the 1 open work item of ${name}` : `the ${openCount} open work items of ${name}`;
  const progress = isFrozen ? "Its progress was frozen earlier and stays as it was then." : "Its progress is frozen as it is now.";
  return `Move ${items}. ${progress}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` of a calendar `Date` through its local getters (the picker hands local midnights; never toISOString). */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** True when `day` falls inside the dated range of any of `cycles` (inclusive at both ends). */
export function isDayTaken(day: string, cycles: readonly Pick<Cycle, "start_date" | "end_date">[]): boolean {
  return cycles.some((cycle) => cycle.start_date !== null && cycle.end_date !== null && cycle.start_date <= day && day <= cycle.end_date);
}

/** True when `[start, end]` intersects the dated range of any of `cycles`. */
export function rangeOverlaps(start: string, end: string, cycles: readonly Pick<Cycle, "start_date" | "end_date">[]): boolean {
  return cycles.some((cycle) => cycle.start_date !== null && cycle.end_date !== null && cycle.start_date <= end && start <= cycle.end_date);
}
