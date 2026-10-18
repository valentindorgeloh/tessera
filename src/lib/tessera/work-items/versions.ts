/**
 * Work item description snapshots (decision 10). The same collapse as pages:
 * the newest row is rewritten when it belongs to the same actor and is under
 * five minutes old. Copies do not copy these rows; a move keeps them because
 * the work item id does not change.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { work_item_version } from "../db/schema";
import { IdSchema } from "../schemas";
import type { VersionInfo } from "../types";
import { loadWorkItem } from "./hydrate";

const COLLAPSE_MS = 5 * 60_000;

export function writeWorkItemVersion(ctx: TesseraContext, item: { id: string; name: string; description_md: string; description_version: number }): void {
  const newest = ctx.db.select().from(work_item_version).where(eq(work_item_version.work_item_id, item.id)).orderBy(desc(work_item_version.created_at)).get();
  const fresh = newest !== undefined && Date.parse(ctx.now()) - Date.parse(newest.created_at) < COLLAPSE_MS;
  if (newest && newest.actor_id === ctx.actor.id && fresh) {
    ctx.db
      .update(work_item_version)
      .set({ name: item.name, description_md: item.description_md, version: item.description_version, created_at: ctx.now() })
      .where(eq(work_item_version.id, newest.id))
      .run();
    return;
  }
  ctx.db
    .insert(work_item_version)
    .values({
      id: newId(),
      work_item_id: item.id,
      name: item.name,
      description_md: item.description_md,
      version: item.description_version,
      actor_id: ctx.actor.id,
      created_at: ctx.now(),
    })
    .run();
}

export const ListWorkItemVersionsInput = z
  .object({
    work_item_id: IdSchema.describe("Work item whose versions are listed."),
    limit: z.number().int().min(1).max(100).optional().describe("How many versions, newest first. Default 20."),
  })
  .strict();

export function listWorkItemVersions(ctx: TesseraContext, input: z.input<typeof ListWorkItemVersionsInput>): VersionInfo[] {
  const data = validateInput(ListWorkItemVersionsInput, input);
  loadWorkItem(ctx, data.work_item_id);
  const rows = ctx.db
    .select()
    .from(work_item_version)
    .where(eq(work_item_version.work_item_id, data.work_item_id))
    .orderBy(desc(work_item_version.created_at), desc(work_item_version.version))
    .limit(data.limit ?? 20)
    .all();
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    name: row.name,
    actor_id: row.actor_id,
    created_at: row.created_at,
    length: row.description_md.length,
  }));
}

export function getWorkItemVersion(ctx: TesseraContext, versionId: string): VersionInfo & { work_item_id: string; description_md: string } {
  const row = ctx.db.select().from(work_item_version).where(eq(work_item_version.id, versionId)).get();
  if (!row) throw notFound("work_item_version", versionId);
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    version: row.version,
    name: row.name,
    actor_id: row.actor_id,
    created_at: row.created_at,
    length: row.description_md.length,
    description_md: row.description_md,
  };
}

export const RestoreWorkItemVersionInput = z
  .object({
    work_item_id: IdSchema.describe("Work item to restore."),
    version_id: IdSchema.describe("Stored version. A version of another item is NOT_FOUND."),
    expected_description_version: z.number().int().min(0).describe("description_version last read; CONFLICT when it moved."),
  })
  .strict();
