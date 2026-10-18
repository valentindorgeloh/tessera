/**
 * Which work items an automation run should close or archive (decision 28).
 * Age is measured in local calendar months from `now`, so a clock frozen in
 * tests selects the same items the hourly run would.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { addDays, addMonthsIso, localDateOf, localDayStart } from "../core/time";
import { state, work_item } from "../db/schema";
import type { ProjectRow, StateGroup, StateRow } from "../types";

/** At most this many items per project per rule in one run. The rest wait for the next run. */
export const AUTOMATION_ITEM_CAP = 500;

const OPEN_GROUPS: readonly StateGroup[] = ["backlog", "unstarted", "started"];

/** Exclusive upper bound: an instant is due when it falls on or before the local day `months` ago. */
export function dueCutoff(now: string, months: number): string {
  return localDayStart(addDays(addMonthsIso(localDateOf(now), -months), 1));
}

function enabled(months: number | null): months is number {
  return months !== null && months >= 1;
}

function live(projectId: string) {
  return and(
    eq(work_item.project_id, projectId),
    isNull(work_item.deleted_at),
    isNull(work_item.archived_at),
    eq(work_item.is_draft, false),
    isNull(state.deleted_at),
  );
}

/** Open items (never triage) whose last update is at least `close_in_months` ago. */
export function dueForClose(ctx: TesseraContext, project: ProjectRow, now: string, limit: number): string[] {
  if (!enabled(project.close_in_months) || limit < 1) return [];
  return ctx.db
    .select({ id: work_item.id })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(and(live(project.id), inArray(state.state_group, [...OPEN_GROUPS]), lt(work_item.updated_at, dueCutoff(now, project.close_in_months))))
    .orderBy(asc(work_item.updated_at), asc(work_item.id))
    .limit(limit)
    .all()
    .map((row) => row.id);
}

/**
 * Completed items aged by `completed_at`, and cancelled items aged by
 * `updated_at` (a cancelled item has no `completed_at`).
 */
export function dueForArchive(ctx: TesseraContext, project: ProjectRow, now: string, limit: number): string[] {
  if (!enabled(project.archive_in_months) || limit < 1) return [];
  const cutoff = dueCutoff(now, project.archive_in_months);
  return ctx.db
    .select({ id: work_item.id })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(
      and(
        live(project.id),
        or(
          and(eq(state.state_group, "completed"), isNotNull(work_item.completed_at), lt(work_item.completed_at, cutoff)),
          and(eq(state.state_group, "cancelled"), lt(work_item.updated_at, cutoff)),
        ),
      ),
    )
    .orderBy(asc(work_item.updated_at), asc(work_item.id))
    .limit(limit)
    .all()
    .map((row) => row.id);
}

/** `close_state_id` when it is completed or cancelled; otherwise the first cancelled state. Null when neither exists. */
export function closeTargetState(ctx: TesseraContext, project: ProjectRow): StateRow | null {
  if (project.close_state_id !== null) {
    const chosen = ctx.db
      .select()
      .from(state)
      .where(and(eq(state.id, project.close_state_id), eq(state.project_id, project.id), isNull(state.deleted_at)))
      .get();
    if (!chosen || (chosen.state_group !== "completed" && chosen.state_group !== "cancelled")) return null;
    return chosen;
  }
  return (
    ctx.db
      .select()
      .from(state)
      .where(and(eq(state.project_id, project.id), eq(state.state_group, "cancelled"), isNull(state.deleted_at)))
      .orderBy(asc(state.sort_order))
      .limit(1)
      .get() ?? null
  );
}
