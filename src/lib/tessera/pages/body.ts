/**
 * Page bodies follow decision 10 with the page-specific shape in decision 43.
 * A body write bumps description_version and collapses versions per actor within 5 minutes.
 */
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { withTx } from "../core/tx";
import { upsertPageFts } from "../db/fts";
import { page, page_version } from "../db/schema";
import type { PageDetail } from "../types";
import { replacePageEmbeds } from "./embeds";
import { assertContentWritable, loadPage, UpdatePageBodyInput, type PageRecord } from "./model";
import { getPage } from "./read";

const COLLAPSE_MS = 5 * 60_000;

export function writePageVersion(ctx: TesseraContext, row: PageRecord, description: string): void {
  const newest = ctx.db.select().from(page_version).where(eq(page_version.page_id, row.id)).orderBy(desc(page_version.created_at)).get();
  const fresh = newest !== undefined && Date.parse(ctx.now()) - Date.parse(newest.created_at) < COLLAPSE_MS;
  if (newest && newest.actor_id === ctx.actor.id && fresh) {
    ctx.db
      .update(page_version)
      .set({ name: row.name, description_md: description, version: row.description_version, created_at: ctx.now() })
      .where(eq(page_version.id, newest.id))
      .run();
    return;
  }
  ctx.db
    .insert(page_version)
    .values({
      id: newId(),
      page_id: row.id,
      name: row.name,
      description_md: description,
      version: row.description_version,
      actor_id: ctx.actor.id,
      created_at: ctx.now(),
    })
    .run();
}

export function updatePageBody(ctx: TesseraContext, input: z.input<typeof UpdatePageBodyInput>): { id: string; description_version: number } {
  const data = UpdatePageBodyInput.parse(input);
  return withTx(ctx, () => {
    const row = loadPage(ctx, data.page_id);
    assertContentWritable(row);
    if (row.description_version !== data.expected_description_version) {
      throw conflict("This page changed", { current_version: row.description_version });
    }
    const version = row.description_version + 1;
    const now = ctx.now();
    const result = ctx.db
      .update(page)
      .set({ description_md: data.description_md, description_version: version, updated_at: now, updated_by: ctx.actor.id })
      .where(and(eq(page.id, row.id), eq(page.description_version, data.expected_description_version)))
      .run();
    if (result.changes === 0) throw conflict("This page changed", { current_version: loadPage(ctx, row.id).description_version });
    const fresh = loadPage(ctx, row.id);
    writePageVersion(ctx, fresh, data.description_md);
    replacePageEmbeds(ctx, row.id, data.description_md);
    upsertPageFts(ctx.sqlite, { id: row.id, project_id: row.project_id, name: fresh.name, body: data.description_md });
    logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: row.id, verb: "description" });
    return { id: row.id, description_version: version };
  });
}

export function restorePageVersion(ctx: TesseraContext, input: { page_id: string; version_id: string; expected_description_version: number }): PageDetail {
  return withTx(ctx, () => {
    const row = loadPage(ctx, input.page_id);
    assertContentWritable(row);
    const version = ctx.db.select().from(page_version).where(and(eq(page_version.id, input.version_id), eq(page_version.page_id, row.id))).get();
    if (!version) throw notFound("page_version", input.version_id);
    updatePageBody(ctx, { page_id: row.id, description_md: version.description_md, expected_description_version: input.expected_description_version });
    if (version.name !== row.name) {
      ctx.db.update(page).set({ name: version.name }).where(eq(page.id, row.id)).run();
    }
    logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: row.id, verb: "restored", new_value: String(version.version) });
    return getPage(ctx, row.id);
  });
}
