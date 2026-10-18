/**
 * Version history for the history dialog: the newest 100 bodies, and for a
 * page the newest 50 activity rows (decision 10).
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "./core/context";
import { validateInput } from "./core/errors";
import { activity, work_item_version } from "./db/schema";
import { listPageVersions } from "./pages";
import { IdSchema } from "./schemas";
import type { HistoryResponse } from "./types";
import { getWorkItem } from "./work-items";

const HistoryInput = z
  .object({
    entity_type: z.enum(["work_item", "page"]).describe("work_item or page."),
    entity_id: IdSchema.describe("Id of the work item or page."),
  })
  .strict();

/** Newest 100 versions with bodies. Pages also include the newest 50 activity rows. */
export function getHistory(ctx: TesseraContext, input: z.input<typeof HistoryInput>): HistoryResponse {
  const data = validateInput(HistoryInput, input);
  if (data.entity_type === "work_item") {
    getWorkItem(ctx, data.entity_id);
    const rows = ctx.db
      .select()
      .from(work_item_version)
      .where(eq(work_item_version.work_item_id, data.entity_id))
      .orderBy(desc(work_item_version.created_at), desc(work_item_version.version))
      .limit(100)
      .all();
    return {
      versions: rows.map((row) => ({
        id: row.id,
        version: row.version,
        name: row.name,
        actor_id: row.actor_id,
        created_at: row.created_at,
        length: row.description_md.length,
        description_md: row.description_md,
      })),
    };
  }
  const versions = listPageVersions(ctx, { page_id: data.entity_id, limit: 100, include_body: true });
  const activityRows = ctx.db
    .select({
      seq: activity.seq,
      verb: activity.verb,
      field: activity.field,
      actor_id: activity.actor_id,
      created_at: activity.created_at,
      comment: activity.comment,
    })
    .from(activity)
    .where(and(eq(activity.entity_type, "page"), eq(activity.entity_id, data.entity_id)))
    .orderBy(desc(activity.seq))
    .limit(50)
    .all();
  return { versions, activity: activityRows };
}
