/**
 * Automation run (decision 28): auto-close inactive items, then auto-archive
 * closed ones, each item in its own transaction as the system actor. A second
 * runner that cannot take the lease returns without writing.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { SYSTEM_ACTOR_ID } from "../actors";
import { withActor, type TesseraContext } from "../core/context";
import { isTrackerError, notFound, validateInput } from "../core/errors";
import { automation_lease, project, webhook_delivery } from "../db/schema";
import { IdSchema } from "../schemas";
import type { AutomationStatus, AutomationSummary, ProjectRow } from "../types";
import { archiveWorkItem } from "../work-items/lifecycle";
import { updateWorkItem } from "../work-items/update";
import { acquireLease, LEASE_TTL_MS, releaseLease } from "./lease";
import { AUTOMATION_ITEM_CAP, closeTargetState, dueForArchive, dueForClose } from "./rules";

export { acquireLease, releaseLease, LEASE_TTL_MS } from "./lease";
export { AUTOMATION_ITEM_CAP, closeTargetState, dueCutoff, dueForArchive, dueForClose } from "./rules";

const STATUS_DUE_LIMIT = 100_000;
const HOUR_MS = 60 * 60 * 1000;
const DELIVERY_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const SKIP_CODES = new Set(["RULE", "LOCKED", "ARCHIVED"]);

export const RunAutomationsInput = z
  .object({
    project_id: IdSchema.optional().describe("Run only this project. Omit to run every active project."),
    dry_run: z.boolean().optional().describe("Return the counts and write nothing."),
  })
  .strict();

export type RunAutomationsInputType = z.input<typeof RunAutomationsInput>;

type ProjectSummary = AutomationSummary["projects"][number];

function monthsLabel(months: number): string {
  return months === 1 ? "1 month" : `${months} months`;
}

function asSystem(ctx: TesseraContext, note: string): TesseraContext {
  const next = withActor(ctx, SYSTEM_ACTOR_ID);
  next.activityNote = note;
  return next;
}

function loadProjects(ctx: TesseraContext, projectId?: string): ProjectRow[] {
  if (projectId !== undefined) {
    const row = ctx.db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), isNull(project.deleted_at)))
      .get();
    if (!row) throw notFound("project", projectId);
    return [row];
  }
  return ctx.db
    .select()
    .from(project)
    .where(and(isNull(project.deleted_at), isNull(project.archived_at)))
    .orderBy(asc(project.sort_order), asc(project.name_key))
    .all();
}

function applyEach(ids: string[], run: (id: string) => void): { done: number; skipped: number; error: string | null } {
  let done = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      run(id);
      done += 1;
    } catch (err) {
      if (isTrackerError(err) && SKIP_CODES.has(err.code)) {
        skipped += 1;
        continue;
      }
      return { done, skipped, error: err instanceof Error ? err.message : "Automation failed" };
    }
  }
  return { done, skipped, error: null };
}

function projectSummary(ctx: TesseraContext, row: ProjectRow, now: string, write: boolean): ProjectSummary {
  const summary: ProjectSummary = { project_id: row.id, closed: 0, archived: 0, skipped: 0, error: null };
  const closeMonths = row.close_in_months !== null && row.close_in_months >= 1 ? row.close_in_months : null;
  if (closeMonths !== null) {
    const ids = dueForClose(ctx, row, now, AUTOMATION_ITEM_CAP);
    const target = ids.length === 0 ? null : closeTargetState(ctx, row);
    if (ids.length > 0 && target === null) {
      summary.error = "No completed or cancelled state to close into";
    } else if (!write) {
      summary.closed = ids.length;
    } else if (target !== null) {
      const stateId = target.id;
      const note = `Closed automatically after ${monthsLabel(closeMonths)} without activity`;
      const result = applyEach(ids, (id) => updateWorkItem(asSystem(ctx, note), id, { state_id: stateId }));
      summary.closed = result.done;
      summary.skipped += result.skipped;
      summary.error = result.error;
    }
  }
  const archiveMonths = row.archive_in_months !== null && row.archive_in_months >= 1 ? row.archive_in_months : null;
  if (archiveMonths !== null) {
    const ids = dueForArchive(ctx, row, now, AUTOMATION_ITEM_CAP);
    if (!write) {
      summary.archived = ids.length;
    } else if (ids.length > 0) {
      const note = `Archived automatically ${monthsLabel(archiveMonths)} after closing`;
      const result = applyEach(ids, (id) => archiveWorkItem(asSystem(ctx, note), id));
      summary.archived = result.done;
      summary.skipped += result.skipped;
      if (summary.error === null) summary.error = result.error;
    }
  }
  return summary;
}

/** Closes and archives due items. A dry run only counts. A held lease writes nothing. */
export function runAutomations(ctx: TesseraContext, input: RunAutomationsInputType = {}): AutomationSummary {
  const data = validateInput(RunAutomationsInput, input);
  const now = ctx.now();
  const projects = loadProjects(ctx, data.project_id);
  if (data.dry_run === true) {
    return { ran_at: now, dry_run: true, lease_held: false, projects: projects.map((row) => projectSummary(ctx, row, now, false)) };
  }
  if (ctx.sqlite.inTransaction) {
    throw new Error("runAutomations commits each item on its own, so it cannot run inside a transaction");
  }
  const holder = `${process.pid}:${randomUUID()}`;
  if (!acquireLease(ctx.sqlite, "automation", holder, now, LEASE_TTL_MS)) {
    return { ran_at: now, dry_run: false, lease_held: true, projects: [] };
  }
  try {
    const summary: AutomationSummary = {
      ran_at: now,
      dry_run: false,
      lease_held: false,
      projects: projects.map((row) => projectSummary(ctx, row, now, true)),
    };
    ctx.db.update(automation_lease).set({ last_run_at: now, last_summary: summary }).where(eq(automation_lease.id, "automation")).run();
    const cutoff = new Date(Date.parse(now) - DELIVERY_KEEP_MS).toISOString();
    ctx.db.delete(webhook_delivery).where(lt(webhook_delivery.created_at, cutoff)).run();
    return summary;
  } finally {
    releaseLease(ctx.sqlite, "automation", holder);
  }
}

/** Last run, the next hourly slot, and how many items each active project would touch now. */
export function getAutomationStatus(ctx: TesseraContext): AutomationStatus {
  const now = ctx.now();
  const lease = ctx.db.select().from(automation_lease).where(eq(automation_lease.id, "automation")).get();
  const held = lease !== undefined && lease.holder !== "" && lease.expires_at > now;
  return {
    last_run_at: lease?.last_run_at ?? null,
    last_summary: (lease?.last_summary as AutomationSummary | null | undefined) ?? null,
    next_run_at: held && lease ? lease.expires_at : lease?.last_run_at ? new Date(Date.parse(lease.last_run_at) + HOUR_MS).toISOString() : null,
    projects: loadProjects(ctx).map((row) => ({
      project_id: row.id,
      archive_in_months: row.archive_in_months,
      close_in_months: row.close_in_months,
      close_state_id: row.close_state_id,
      due_close: dueForClose(ctx, row, now, STATUS_DUE_LIMIT).length,
      due_archive: dueForArchive(ctx, row, now, STATUS_DUE_LIMIT).length,
    })),
  };
}
