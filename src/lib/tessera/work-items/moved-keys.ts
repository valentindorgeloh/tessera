import { and, desc, eq, isNull } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { activity, project } from "../db/schema";
import { formatKey } from "../core/keys";

/**
 * Id of the item that carried `identifier-sequenceId` before `move_work_item_to_project`
 * gave it a new key in another project (decision 29, extended to moves). The old
 * key lives only in the `moved` activity row's `old_identifier`: no alias table,
 * no schema change. The newest row wins; callers check the live key first, so a
 * key held by a live item always beats a moved one. A former identifier loses to
 * a project that uses it now: when a live project holds `identifier` and it is
 * not the project the item left (the row's `old_value`), the key is not the
 * item's any more. The caller still has to check the item is not deleted (and,
 * for search, that it passes its own guards).
 */
export function findMovedWorkItemId(ctx: TesseraContext, identifier: string, sequenceId: number): string | undefined {
  const rows = ctx.db
    .select({ id: activity.entity_id, source_project_id: activity.old_value })
    .from(activity)
    .where(
      and(
        eq(activity.entity_type, "work_item"),
        eq(activity.verb, "moved"),
        eq(activity.field, "project_id"),
        eq(activity.old_identifier, formatKey(identifier, sequenceId)),
      ),
    )
    .orderBy(desc(activity.seq))
    .all();
  if (rows.length === 0) return undefined;
  const holder = ctx.db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.identifier, identifier), isNull(project.deleted_at)))
    .get();
  if (holder === undefined) return rows[0].id;
  return rows.find((row) => row.source_project_id === holder.id)?.id;
}
