/**
 * Creating and editing page properties (decision 40).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { notFound, rule, validation } from "../core/errors";
import { newId } from "../core/ids";
import { sortOrderAfter, sortOrderBetween } from "../core/order";
import { withTx } from "../core/tx";
import { deletePageFts, upsertPageFts } from "../db/fts";
import { label, page, page_label } from "../db/schema";
import type { PageDetail } from "../types";
import { replacePageEmbeds } from "./embeds";
import { writePageVersion } from "./body";
import {
  assertContentWritable,
  assertPagesEnabled,
  assertProjectWritable,
  loadPage,
  sameSpace,
  type PageRecord,
  CreatePageInput,
  UpdatePageInput,
} from "./model";
import { getPage } from "./read";

function lastSiblingKey(ctx: TesseraContext, projectId: string | null, parentId: string | null): string | null {
  const rows = ctx.db
    .select({ sort_order: page.sort_order })
    .from(page)
    .where(and(projectId === null ? isNull(page.project_id) : eq(page.project_id, projectId), parentId === null ? isNull(page.parent_id) : eq(page.parent_id, parentId), isNull(page.deleted_at)))
    .all()
    .map((row) => row.sort_order)
    .sort();
  return rows.at(-1) ?? null;
}

function assertParent(ctx: TesseraContext, parentId: string | null | undefined, projectId: string | null): void {
  if (!parentId) return;
  const parent = loadPage(ctx, parentId);
  if (!sameSpace(parent.project_id, projectId)) throw validation({ parent_id: parentId }, "Parent is in another space");
}

function replaceLabels(ctx: TesseraContext, row: PageRecord, labelIds: string[]): void {
  if (row.project_id === null) throw rule("wiki_page_labels", "Wiki pages cannot have labels");
  for (const id of labelIds) {
    const found = ctx.db.select().from(label).where(and(eq(label.id, id), eq(label.project_id, row.project_id), isNull(label.deleted_at))).get();
    if (!found) throw notFound("label", id);
  }
  ctx.db.delete(page_label).where(eq(page_label.page_id, row.id)).run();
  for (const id of labelIds) ctx.db.insert(page_label).values({ page_id: row.id, label_id: id }).run();
}

export function createPage(ctx: TesseraContext, input: z.input<typeof CreatePageInput>): PageDetail {
  const data = CreatePageInput.parse(input);
  return withTx(ctx, () => {
    assertProjectWritable(ctx, data.project_id);
    assertPagesEnabled(ctx, data.project_id);
    assertParent(ctx, data.parent_id, data.project_id);
    if (data.project_id === null && (data.label_ids?.length ?? 0) > 0) throw rule("wiki_page_labels", "Wiki pages cannot have labels");
    const id = newId();
    const now = ctx.now();
    ctx.db
      .insert(page)
      .values({
        id,
        project_id: data.project_id,
        parent_id: data.parent_id ?? null,
        name: data.name,
        description_md: data.description_md ?? "",
        description_version: 0,
        access: data.access,
        is_locked: false,
        logo: data.logo ?? null,
        sort_order: sortOrderAfter(lastSiblingKey(ctx, data.project_id, data.parent_id ?? null)),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .run();
    const row = loadPage(ctx, id);
    if (data.label_ids?.length) replaceLabels(ctx, row, data.label_ids);
    upsertPageFts(ctx.sqlite, { id, project_id: data.project_id, name: data.name, body: data.description_md ?? "" });
    if (data.description_md) replacePageEmbeds(ctx, id, data.description_md);
    writePageVersion(ctx, row, data.description_md ?? "");
    logActivity(ctx, { project_id: data.project_id, entity_type: "page", entity_id: id, verb: "created", new_identifier: data.name });
    return getPage(ctx, id);
  });
}

export function updatePage(ctx: TesseraContext, input: z.input<typeof UpdatePageInput>): PageDetail {
  const data = UpdatePageInput.parse(input);
  return withTx(ctx, () => {
    const row = loadPage(ctx, data.page_id);
    assertContentWritable(row);
    assertProjectWritable(ctx, row.project_id);
    const now = ctx.now();
    if (data.name !== undefined && data.name !== row.name) {
      ctx.db.update(page).set({ name: data.name, updated_at: now, updated_by: ctx.actor.id }).where(eq(page.id, row.id)).run();
      logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: row.id, verb: "updated", field: "name", old_identifier: row.name, new_identifier: data.name });
    }
    if (data.access !== undefined && data.access !== row.access) {
      ctx.db.update(page).set({ access: data.access, updated_at: now, updated_by: ctx.actor.id }).where(eq(page.id, row.id)).run();
      logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: row.id, verb: "updated", field: "access", old_value: row.access, new_value: data.access });
    }
    if (data.logo !== undefined) {
      ctx.db.update(page).set({ logo: data.logo, updated_at: now, updated_by: ctx.actor.id }).where(eq(page.id, row.id)).run();
      logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: row.id, verb: "updated", field: "logo" });
    }
    if (data.label_ids) {
      replaceLabels(ctx, row, data.label_ids);
      logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: row.id, verb: "updated", field: "labels" });
    }
    const fresh = loadPage(ctx, row.id);
    upsertPageFts(ctx.sqlite, { id: fresh.id, project_id: fresh.project_id, name: fresh.name, body: fresh.description_md });
    return getPage(ctx, fresh.id);
  });
}

export function duplicatePage(ctx: TesseraContext, pageId: string): PageDetail {
  return withTx(ctx, () => {
    const source = loadPage(ctx, pageId);
    assertProjectWritable(ctx, source.project_id);
    assertPagesEnabled(ctx, source.project_id);
    const copy = createPage(ctx, {
      project_id: source.project_id,
      parent_id: source.parent_id,
      name: `${source.name} (Copy)`.slice(0, 255),
      description_md: source.description_md,
      access: source.access,
      logo: source.logo,
      label_ids: source.project_id ? undefined : undefined,
    });
    if (source.project_id) {
      const ids = ctx.db.select().from(page_label).where(eq(page_label.page_id, source.id)).all().map((row) => row.label_id);
      if (ids.length) updatePage(ctx, { page_id: copy.id, label_ids: ids });
    }
    const placed = sortOrderBetween(source.sort_order, null);
    ctx.db.update(page).set({ sort_order: placed }).where(eq(page.id, copy.id)).run();
    return getPage(ctx, copy.id);
  });
}
