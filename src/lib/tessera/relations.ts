/**
 * Work item relations with inverse display (decision 55). One live row per
 * unordered pair, stored in the canonical direction.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, notFound, validation } from "./core/errors";
import { newId } from "./core/ids";
import { withTx } from "./core/tx";
import { work_item_relation } from "./db/schema";
import { IdSchema } from "./schemas";
import type { RelationType } from "./types";
import { getWorkItem } from "./work-items";

const DISPLAY = z.enum([
  "blocked_by",
  "blocking",
  "relates_to",
  "duplicate",
  "start_before",
  "start_after",
  "finish_before",
  "finish_after",
  "implemented_by",
  "implements",
]);

const TO_CANONICAL: Record<z.infer<typeof DISPLAY>, RelationType> = {
  blocked_by: "blocked_by",
  blocking: "blocked_by",
  relates_to: "relates_to",
  duplicate: "duplicate",
  start_before: "start_before",
  start_after: "start_before",
  finish_before: "finish_before",
  finish_after: "finish_before",
  implemented_by: "implemented_by",
  implements: "implemented_by",
};

const SWAPS = new Set(["blocking", "start_after", "finish_after", "implements"]);

export const AddRelationInput = z
  .object({
    work_item_id: IdSchema.describe("The work item this relation is added from."),
    related_work_item_id: IdSchema.describe("The other work item, in any project."),
    relation_type: DISPLAY.describe("Relation from this item's side, for example blocked_by or blocking."),
  })
  .strict();

export type RelationView = {
  id: string;
  relation_type: z.infer<typeof DISPLAY>;
  work_item_id: string;
  related_work_item_id: string;
};

function displayFrom(sideId: string, storedA: string, storedType: RelationType): z.infer<typeof DISPLAY> {
  if (storedType === "relates_to" || storedType === "duplicate") return storedType;
  const forward = sideId === storedA;
  if (storedType === "blocked_by") return forward ? "blocked_by" : "blocking";
  if (storedType === "start_before") return forward ? "start_before" : "start_after";
  if (storedType === "finish_before") return forward ? "finish_before" : "finish_after";
  return forward ? "implemented_by" : "implements";
}

export function listRelations(ctx: TesseraContext, workItemId: string): RelationView[] {
  getWorkItem(ctx, workItemId);
  const rows = ctx.db
    .select()
    .from(work_item_relation)
    .where(and(or(eq(work_item_relation.work_item_id, workItemId), eq(work_item_relation.related_work_item_id, workItemId)), isNull(work_item_relation.deleted_at)))
    .all();
  return rows.map((row) => ({
    id: row.id,
    relation_type: displayFrom(workItemId, row.work_item_id, row.relation_type),
    work_item_id: workItemId,
    related_work_item_id: row.work_item_id === workItemId ? row.related_work_item_id : row.work_item_id,
  }));
}

export function addRelation(ctx: TesseraContext, input: z.input<typeof AddRelationInput>): RelationView {
  const data = AddRelationInput.parse(input);
  if (data.work_item_id === data.related_work_item_id) throw validation({ related_work_item_id: data.related_work_item_id }, "A work item cannot relate to itself");
  return withTx(ctx, () => {
    const left = getWorkItem(ctx, data.work_item_id);
    const right = getWorkItem(ctx, data.related_work_item_id);
    if (left.archived_at || right.archived_at) throw archived("Archived work items cannot be related");
    const swap = SWAPS.has(data.relation_type);
    const canonical = TO_CANONICAL[data.relation_type];
    let a = swap ? data.related_work_item_id : data.work_item_id;
    let b = swap ? data.work_item_id : data.related_work_item_id;
    if (canonical === "relates_to" || canonical === "duplicate") {
      [a, b] = [a, b].sort();
    }
    const existing = ctx.db
      .select()
      .from(work_item_relation)
      .where(
        and(
          or(
            and(eq(work_item_relation.work_item_id, data.work_item_id), eq(work_item_relation.related_work_item_id, data.related_work_item_id)),
            and(eq(work_item_relation.work_item_id, data.related_work_item_id), eq(work_item_relation.related_work_item_id, data.work_item_id)),
          ),
          isNull(work_item_relation.deleted_at),
        ),
      )
      .get();
    if (existing) {
      ctx.db.update(work_item_relation).set({ deleted_at: ctx.now() }).where(eq(work_item_relation.id, existing.id)).run();
    }
    const id = newId();
    ctx.db
      .insert(work_item_relation)
      .values({
        id,
        work_item_id: a,
        related_work_item_id: b,
        relation_type: canonical,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .run();
    logActivity(ctx, { project_id: left.project_id, entity_type: "work_item", entity_id: left.id, work_item_id: left.id, verb: "added", field: data.relation_type, new_value: right.id, new_identifier: right.key });
    logActivity(ctx, { project_id: right.project_id, entity_type: "work_item", entity_id: right.id, work_item_id: right.id, verb: "added", field: displayFrom(right.id, a, canonical), new_value: left.id, new_identifier: left.key });
    return { id, relation_type: data.relation_type, work_item_id: data.work_item_id, related_work_item_id: data.related_work_item_id };
  });
}

export function removeRelation(ctx: TesseraContext, workItemId: string, relatedId: string): void {
  withTx(ctx, () => {
    const row = ctx.db
      .select()
      .from(work_item_relation)
      .where(
        and(
          or(
            and(eq(work_item_relation.work_item_id, workItemId), eq(work_item_relation.related_work_item_id, relatedId)),
            and(eq(work_item_relation.work_item_id, relatedId), eq(work_item_relation.related_work_item_id, workItemId)),
          ),
          isNull(work_item_relation.deleted_at),
        ),
      )
      .get();
    if (!row) throw notFound("relation", relatedId);
    ctx.db.update(work_item_relation).set({ deleted_at: ctx.now() }).where(eq(work_item_relation.id, row.id)).run();
    logActivity(ctx, { entity_type: "work_item", entity_id: workItemId, work_item_id: workItemId, verb: "removed", field: "relation", new_value: relatedId });
  });
}
