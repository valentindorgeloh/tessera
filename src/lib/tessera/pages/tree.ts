/**
 * Moving a page moves its subtree and keeps every id (decision 40).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { notFound, validation } from "../core/errors";
import { sortOrderBetween } from "../core/order";
import { withTx } from "../core/tx";
import { upsertPageFts } from "../db/fts";
import { page, page_label } from "../db/schema";
import type { PageDetail } from "../types";
import { assertContentWritable, assertPagesEnabled, assertProjectWritable, loadPage, sameSpace, MovePageInput } from "./model";
import { getPage } from "./read";

export function descendantIds(ctx: TesseraContext, pageId: string): string[] {
  const rows = ctx.sqlite
    .prepare(
      `WITH RECURSIVE d(id) AS (
         SELECT id FROM page WHERE parent_id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT p.id FROM page p JOIN d ON p.parent_id = d.id WHERE p.deleted_at IS NULL
       ) SELECT id FROM d`,
    )
    .all(pageId) as { id: string }[];
  return rows.map((row) => row.id);
}

export function movePage(ctx: TesseraContext, input: z.input<typeof MovePageInput>): PageDetail {
  const data = MovePageInput.parse(input);
  return withTx(ctx, () => {
    const row = loadPage(ctx, data.page_id);
    assertContentWritable(row);
    const targetProject = data.project_id === undefined ? row.project_id : data.project_id;
    const targetParent = data.parent_id === undefined ? row.parent_id : data.parent_id;
    assertProjectWritable(ctx, targetProject);
    if (targetProject !== row.project_id) assertPagesEnabled(ctx, targetProject);
    if (targetParent) {
      const parent = loadPage(ctx, targetParent);
      if (!sameSpace(parent.project_id, targetProject)) throw validation({ parent_id: targetParent }, "Parent is in another space");
      if (targetParent === row.id || descendantIds(ctx, row.id).includes(targetParent)) {
        throw validation({ parent_id: targetParent }, "A page cannot move under itself");
      }
    }
    const sort = siblingKey(ctx, targetProject, targetParent, data.before_id, data.after_id, row.id);
    const leaving = row.project_id !== null && targetProject !== row.project_id;
    const ids = [row.id, ...descendantIds(ctx, row.id)];
    ctx.db.update(page).set({ project_id: targetProject, parent_id: targetParent, sort_order: sort, updated_at: ctx.now(), updated_by: ctx.actor.id }).where(eq(page.id, row.id)).run();
    for (const id of descendantIds(ctx, row.id)) {
      ctx.db.update(page).set({ project_id: targetProject, updated_at: ctx.now(), updated_by: ctx.actor.id }).where(eq(page.id, id)).run();
    }
    if (leaving) {
      for (const id of ids) {
        ctx.db.delete(page_label).where(eq(page_label.page_id, id)).run();
        logActivity(ctx, { project_id: targetProject, entity_type: "page", entity_id: id, verb: "updated", field: "labels" });
      }
    }
    logActivity(ctx, { project_id: targetProject, entity_type: "page", entity_id: row.id, verb: "updated", field: "parent", old_value: row.parent_id, new_value: targetParent });
    if (targetProject !== row.project_id) {
      logActivity(ctx, { project_id: targetProject, entity_type: "page", entity_id: row.id, verb: "updated", field: "project", old_value: row.project_id, new_value: targetProject });
    }
    for (const id of ids) {
      const fresh = loadPage(ctx, id);
      upsertPageFts(ctx.sqlite, { id, project_id: fresh.project_id, name: fresh.name, body: fresh.description_md });
    }
    return getPage(ctx, row.id);
  });
}

function siblingKey(ctx: TesseraContext, projectId: string | null, parentId: string | null, beforeId: string | undefined, afterId: string | undefined, selfId: string): string {
  const siblings = ctx.db
    .select()
    .from(page)
    .where(and(projectId === null ? isNull(page.project_id) : eq(page.project_id, projectId), parentId === null ? isNull(page.parent_id) : eq(page.parent_id, parentId), isNull(page.deleted_at)))
    .all()
    .filter((row) => row.id !== selfId)
    .sort((a, b) => (a.sort_order < b.sort_order ? -1 : 1));
  if (!beforeId && !afterId) return sortOrderBetween(siblings.at(-1)?.sort_order ?? null, null);
  const before = beforeId ? siblings.find((row) => row.id === beforeId) : undefined;
  const after = afterId ? siblings.find((row) => row.id === afterId) : undefined;
  if (beforeId && !before) throw notFound("page", beforeId);
  if (afterId && !after) throw notFound("page", afterId);
  if (before) {
    const index = siblings.indexOf(before);
    return sortOrderBetween(siblings[index - 1]?.sort_order ?? null, before.sort_order);
  }
  const index = siblings.indexOf(after!);
  return sortOrderBetween(after!.sort_order, siblings[index + 1]?.sort_order ?? null);
}
