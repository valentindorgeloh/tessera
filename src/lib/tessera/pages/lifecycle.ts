/**
 * Lock, archive and delete (decision 41).
 */
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { archived, locked, rule } from "../core/errors";
import { withTx } from "../core/tx";
import { deletePageFts } from "../db/fts";
import { favorite, page } from "../db/schema";
import type { PageDetail } from "../types";
import { loadPage } from "./model";
import { getPage } from "./read";
import { descendantIds } from "./tree";

export function lockPage(ctx: TesseraContext, pageId: string): PageDetail {
  return withTx(ctx, () => setLock(ctx, pageId, true));
}

export function unlockPage(ctx: TesseraContext, pageId: string): PageDetail {
  return withTx(ctx, () => setLock(ctx, pageId, false));
}

function setLock(ctx: TesseraContext, pageId: string, isLocked: boolean): PageDetail {
  const row = loadPage(ctx, pageId);
  if (row.archived_at !== null) throw archived("This page is archived");
  ctx.db.update(page).set({ is_locked: isLocked, updated_at: ctx.now(), updated_by: ctx.actor.id }).where(eq(page.id, pageId)).run();
  logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: pageId, verb: isLocked ? "locked" : "unlocked" });
  return getPage(ctx, pageId);
}

export function archivePage(ctx: TesseraContext, pageId: string): PageDetail {
  return withTx(ctx, () => {
    const row = loadPage(ctx, pageId);
    const stamp = ctx.now();
    const ids = [row.id, ...descendantIds(ctx, row.id)];
    for (const id of ids) {
      const current = loadPage(ctx, id);
      if (current.archived_at !== null) continue;
      ctx.db.update(page).set({ archived_at: stamp, updated_at: stamp, updated_by: ctx.actor.id }).where(eq(page.id, id)).run();
      logActivity(ctx, { project_id: current.project_id, entity_type: "page", entity_id: id, verb: "archived" });
    }
    return getPage(ctx, pageId);
  });
}

export function unarchivePage(ctx: TesseraContext, pageId: string): PageDetail {
  return withTx(ctx, () => {
    const row = loadPage(ctx, pageId);
    if (row.archived_at === null) return getPage(ctx, pageId);
    const stamp = row.archived_at;
    const ids = [row.id, ...descendantIds(ctx, row.id)].filter((id) => loadPage(ctx, id).archived_at === stamp);
    let parentId = row.parent_id;
    if (parentId) {
      const parent = ctx.db.select().from(page).where(and(eq(page.id, parentId), isNull(page.deleted_at))).get();
      if (parent?.archived_at) parentId = null;
    }
    for (const id of ids) {
      const current = loadPage(ctx, id);
      ctx.db
        .update(page)
        .set({ archived_at: null, ...(id === row.id ? { parent_id: parentId } : {}), updated_at: ctx.now(), updated_by: ctx.actor.id })
        .where(eq(page.id, id))
        .run();
      logActivity(ctx, { project_id: current.project_id, entity_type: "page", entity_id: id, verb: "unarchived" });
    }
    return getPage(ctx, pageId);
  });
}

export function deletePage(ctx: TesseraContext, pageId: string): { id: string; deleted: true } {
  return withTx(ctx, () => {
    const row = loadPage(ctx, pageId);
    if (row.is_locked) throw locked("This page is locked");
    if (row.archived_at === null) throw rule("page_not_archived", "Archive the page before deleting it");
    const now = ctx.now();
    ctx.db.update(page).set({ deleted_at: now, parent_id: null, updated_at: now, updated_by: ctx.actor.id }).where(eq(page.id, pageId)).run();
    ctx.db.update(page).set({ parent_id: null }).where(and(eq(page.parent_id, pageId), isNull(page.deleted_at))).run();
    ctx.db.update(favorite).set({ deleted_at: now }).where(and(eq(favorite.entity_type, "page"), eq(favorite.entity_id, pageId), isNull(favorite.deleted_at))).run();
    deletePageFts(ctx.sqlite, pageId);
    logActivity(ctx, { project_id: row.project_id, entity_type: "page", entity_id: pageId, verb: "deleted" });
    return { id: pageId, deleted: true };
  });
}
