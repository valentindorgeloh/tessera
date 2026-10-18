/**
 * Undo of the latest work-item field update or archive.
 *
 * The activity row already stores the previous field value, and an archive
 * is reversed by unarchive. This does not add a second undo log and does not
 * cover other tools. The inverse write is an activity row of its own and is
 * not undone again.
 */
import { and, desc, eq } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { rule } from "../core/errors";
import { activity } from "../db/schema";
import { unarchiveWorkItem } from "./lifecycle";
import { ENTITY, getWorkItemRow } from "./model";
import { updateWorkItem, type UpdateWorkItemInputType } from "./update";

/** Marks the inverse activity row so a second call does not undo the undo. */
export const UNDO_NOTE = "Undid work item change";

/** Fields `applyPatch` records with old and new values. */
const UPDATE_FIELDS = ["name", "state_id", "priority", "parent_id", "cycle_id", "estimate_point_id", "start_date", "target_date"] as const;

type UpdateField = (typeof UPDATE_FIELDS)[number];

export type WorkItemUndo = {
  work_item_id: string;
  /** Activity seq that was reversed. */
  seq: number;
  verb: "updated" | "archived";
  field: string | null;
};

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

/**
 * Reverses the newest activity row on `workItemId` when it is a stored field
 * update or an archive. Refuses creates, deletes, comments and a row this
 * function already wrote.
 */
export function undoLastWorkItemChange(ctx: TesseraContext, workItemId: string): WorkItemUndo {
  getWorkItemRow(ctx, workItemId);
  const row = ctx.db
    .select()
    .from(activity)
    .where(and(eq(activity.entity_type, ENTITY), eq(activity.entity_id, workItemId)))
    .orderBy(desc(activity.seq))
    .limit(1)
    .get();
  if (!row) throw rule("nothing_to_undo", "This work item has no activity to undo");
  if (row.comment === UNDO_NOTE) {
    throw rule("undo_already_applied", "The latest change on this work item is already an undo");
  }
  const noted: TesseraContext = { ...ctx, activityNote: UNDO_NOTE };
  if (row.verb === "archived") {
    unarchiveWorkItem(noted, workItemId);
    return { work_item_id: workItemId, seq: row.seq, verb: "archived", field: null };
  }
  if (row.verb === "updated" && isUpdateField(row.field)) {
    updateWorkItem(noted, workItemId, inversePatch(row.field, row.old_value));
    return { work_item_id: workItemId, seq: row.seq, verb: "updated", field: row.field };
  }
  throw rule("not_undoable", `Cannot undo ${row.verb}${row.field ? ` of ${row.field}` : ""} from the activity log`);
}
