/**
 * Undo the latest applied assistant batch (decisions 116–117).
 *
 * Scope for this pass: reverses work-item field updates and archives written
 * by the batch's activity rows, newest first. Other verbs refuse the whole
 * undo with CONFLICT. The caller is the user; each inverse carries a fixed note.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { ASSISTANT_ACTOR_ID } from "../actors";
import type { TesseraContext } from "../core/context";
import { conflict, rule } from "../core/errors";
import { withTx } from "../core/tx";
import { activity, ai_proposal } from "../db/schema";
import { unarchiveWorkItem } from "../work-items/lifecycle";
import { ENTITY } from "../work-items/model";
import { updateWorkItem, type UpdateWorkItemInputType } from "../work-items/update";
import { ASSISTANT_UNDO_NOTE as NOTE } from "./undo-note";

export { ASSISTANT_UNDO_NOTE } from "./undo-note";

const HOUR_MS = 60 * 60 * 1000;
export const UNDO_BATCH_TTL_MS = 24 * HOUR_MS;

export type AppliedBatch = {
  batch_id: string;
  applied_at: string;
  proposal_ids: string[];
  seq_from: number;
  seq_to: number;
  titles: string[];
};

type ProposalRow = typeof ai_proposal.$inferSelect;

const UPDATE_FIELDS = ["name", "state_id", "priority", "parent_id", "cycle_id", "estimate_point_id", "start_date", "target_date"] as const;
type UpdateField = (typeof UPDATE_FIELDS)[number];

function isUpdateField(field: string | null): field is UpdateField {
  return field !== null && (UPDATE_FIELDS as readonly string[]).includes(field);
}

function inversePatch(field: UpdateField, oldValue: string | null): UpdateWorkItemInputType {
  if (oldValue === null && (field === "name" || field === "state_id" || field === "priority")) {
    throw rule("not_undoable", `The previous ${field} was not stored`);
  }
  switch (field) {
    case "name":
      return { name: oldValue ?? "" };
    case "state_id":
      return { state_id: oldValue ?? "" };
    case "priority":
      return { priority: oldValue as UpdateWorkItemInputType["priority"] };
    case "parent_id":
      return { parent_id: oldValue };
    case "cycle_id":
      return { cycle_id: oldValue };
    case "estimate_point_id":
      return { estimate_point_id: oldValue };
    case "start_date":
      return { start_date: oldValue };
    case "target_date":
      return { target_date: oldValue };
  }
}

function batchFromRows(rows: ProposalRow[]): AppliedBatch | null {
  if (rows.length === 0) return null;
  const batchId = rows[0].apply_batch_id;
  if (!batchId) return null;
  const seqFrom = Math.min(...rows.map((row) => row.seq_from ?? Number.POSITIVE_INFINITY));
  const seqTo = Math.max(...rows.map((row) => row.seq_to ?? Number.NEGATIVE_INFINITY));
  if (!Number.isFinite(seqFrom) || !Number.isFinite(seqTo)) return null;
  return {
    batch_id: batchId,
    applied_at: rows[0].decided_at ?? rows[0].created_at,
    proposal_ids: rows.map((row) => row.id),
    seq_from: seqFrom,
    seq_to: seqTo,
    titles: rows.map((row) => (row.preview as { title?: string }).title ?? row.tool),
  };
}

/** Latest applied batch that is still within 24 h and not undone. */
export function findLatestUndoableBatch(ctx: TesseraContext, now: string = ctx.now()): AppliedBatch | null {
  const cutoff = new Date(Date.parse(now) - UNDO_BATCH_TTL_MS).toISOString();
  const rows = ctx.db
    .select()
    .from(ai_proposal)
    .where(
      and(
        eq(ai_proposal.status, "applied"),
        isNotNull(ai_proposal.apply_batch_id),
        isNull(ai_proposal.undone_at),
        gte(ai_proposal.decided_at, cutoff),
      ),
    )
    .orderBy(desc(ai_proposal.decided_at))
    .all();
  if (rows.length === 0) return null;
  const batchId = rows[0].apply_batch_id;
  if (!batchId) return null;
  return batchFromRows(rows.filter((row) => row.apply_batch_id === batchId));
}

/** Batch id only, for retention keep-alive. */
export function findLatestUndoableBatchId(ctx: TesseraContext, now: string): string | null {
  return findLatestUndoableBatch(ctx, now)?.batch_id ?? null;
}

function touchKey(entityType: string, entityId: string, field: string | null): string {
  return `${entityType}:${entityId}:${field ?? "*"}`;
}

function blockedByLater(ctx: TesseraContext, batch: AppliedBatch): string[] {
  const blocked: string[] = [];
  const later = ctx.db.select().from(activity).where(gt(activity.seq, batch.seq_to)).orderBy(asc(activity.seq)).all();
  const batchRows = ctx.db
    .select()
    .from(activity)
    .where(and(eq(activity.actor_id, ASSISTANT_ACTOR_ID), gte(activity.seq, batch.seq_from), lte(activity.seq, batch.seq_to)))
    .all();
  const touched = new Set(batchRows.map((row) => touchKey(row.entity_type, row.entity_id, row.field)));
  const entities = new Set(batchRows.map((row) => `${row.entity_type}:${row.entity_id}`));
  for (const row of later) {
    if (row.comment === NOTE) continue;
    const key = touchKey(row.entity_type, row.entity_id, row.field);
    const entity = `${row.entity_type}:${row.entity_id}`;
    if (touched.has(key) || (row.verb === "deleted" && entities.has(entity))) {
      blocked.push(`${row.verb} ${row.entity_type} ${row.entity_id}${row.field ? `.${row.field}` : ""} @${row.seq}`);
    }
  }
  return blocked;
}

function invertRow(ctx: TesseraContext, row: typeof activity.$inferSelect): void {
  if (row.entity_type !== ENTITY) {
    throw conflict("undo_blocked", { blocked: [`${row.verb} ${row.entity_type}`] });
  }
  if (row.verb === "archived") {
    unarchiveWorkItem(ctx, row.entity_id);
    return;
  }
  if (row.verb === "updated" && isUpdateField(row.field)) {
    updateWorkItem(ctx, row.entity_id, inversePatch(row.field, row.old_value));
    return;
  }
  throw conflict("undo_blocked", { blocked: [`${row.verb}${row.field ? ` of ${row.field}` : ""}`] });
}

/**
 * Reverses the latest undoable assistant batch. Only work-item field updates
 * and archives are inverted; any other activity in the batch refuses the call.
 */
export function undoLastAssistantBatch(ctx: TesseraContext): AppliedBatch & { undone_at: string } {
  const batch = findLatestUndoableBatch(ctx);
  if (!batch) throw rule("nothing_to_undo", "There is no assistant batch to undo");
  const blocked = blockedByLater(ctx, batch);
  if (blocked.length > 0) throw conflict("undo_blocked", { blocked });

  const rows = ctx.db
    .select()
    .from(activity)
    .where(and(eq(activity.actor_id, ASSISTANT_ACTOR_ID), gte(activity.seq, batch.seq_from), lte(activity.seq, batch.seq_to)))
    .orderBy(desc(activity.seq))
    .all();

  return withTx(ctx, () => {
    const noted: TesseraContext = { ...ctx, activityNote: NOTE };
    const undoFrom = (ctx.db.select({ m: sql<number>`max(${activity.seq})` }).from(activity).get()?.m ?? 0) + 1;
    for (const row of rows) invertRow(noted, row);
    const undoTo = ctx.db.select({ m: sql<number>`max(${activity.seq})` }).from(activity).get()?.m ?? undoFrom;
    const undoneAt = ctx.now();
    ctx.db
      .update(ai_proposal)
      .set({ undone_at: undoneAt, undo_seq_from: undoFrom, undo_seq_to: undoTo })
      .where(and(eq(ai_proposal.apply_batch_id, batch.batch_id), inArray(ai_proposal.id, batch.proposal_ids)))
      .run();
    return { ...batch, undone_at: undoneAt };
  });
}
