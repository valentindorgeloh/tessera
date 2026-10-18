/**
 * Favourites and one-level folders. At most one live favourite per entity.
 * The top level mixes folders and unfoldered favourites in one sort key;
 * a folder's favourites have their own keys. Deleting a folder appends its
 * favourites to the top level.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { conflict, notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { sortOrderAfter, sortOrderForMove, type OrderedRow } from "../core/order";
import { withTx } from "../core/tx";
import { cycle, favorite, favorite_folder, moduleTable, page, project, view } from "../db/schema";
import { FavoriteEntityTypeSchema, IdSchema } from "../schemas";
import type { FavoriteEntityType, FavoriteFolderView, FavoriteView, FavoritesTree, Logo } from "../types";

const FOLDER_NAME = z.string().trim().min(1).max(80);

type LiveEntity = {
  name: string;
  href: string;
  logo: Logo | null;
  project_id: string | null;
  project_name: string | null;
};

function idsOf(rows: { entity_type: FavoriteEntityType; entity_id: string }[], type: FavoriteEntityType): string[] {
  return rows.filter((row) => row.entity_type === type).map((row) => row.entity_id);
}

function loadLive(ctx: TesseraContext, rows: { entity_type: FavoriteEntityType; entity_id: string }[]): Map<string, LiveEntity> {
  const found = new Map<string, LiveEntity>();
  const projectIds = idsOf(rows, "project");
  if (projectIds.length > 0) {
    for (const row of ctx.db
      .select({ id: project.id, name: project.name, logo: project.logo })
      .from(project)
      .where(and(inArray(project.id, projectIds), isNull(project.deleted_at), isNull(project.archived_at)))
      .all()) {
      found.set(`project:${row.id}`, {
        name: row.name,
        href: `/projects/${row.id}/work-items`,
        logo: row.logo,
        project_id: row.id,
        project_name: row.name,
      });
    }
  }
  const cycleIds = idsOf(rows, "cycle");
  if (cycleIds.length > 0) {
    for (const row of ctx.db
      .select({ id: cycle.id, name: cycle.name, project_id: cycle.project_id, project_name: project.name })
      .from(cycle)
      .innerJoin(project, eq(cycle.project_id, project.id))
      .where(and(inArray(cycle.id, cycleIds), isNull(cycle.deleted_at), isNull(cycle.archived_at), isNull(project.deleted_at), isNull(project.archived_at)))
      .all()) {
      found.set(`cycle:${row.id}`, {
        name: row.name,
        href: `/projects/${row.project_id}/cycles/${row.id}`,
        logo: null,
        project_id: row.project_id,
        project_name: row.project_name,
      });
    }
  }
  const moduleIds = idsOf(rows, "module");
  if (moduleIds.length > 0) {
    for (const row of ctx.db
      .select({ id: moduleTable.id, name: moduleTable.name, project_id: moduleTable.project_id, project_name: project.name })
      .from(moduleTable)
      .innerJoin(project, eq(moduleTable.project_id, project.id))
      .where(
        and(
          inArray(moduleTable.id, moduleIds),
          isNull(moduleTable.deleted_at),
          isNull(moduleTable.archived_at),
          isNull(project.deleted_at),
          isNull(project.archived_at),
        ),
      )
      .all()) {
      found.set(`module:${row.id}`, {
        name: row.name,
        href: `/projects/${row.project_id}/modules/${row.id}`,
        logo: null,
        project_id: row.project_id,
        project_name: row.project_name,
      });
    }
  }
  const viewIds = idsOf(rows, "view");
  if (viewIds.length > 0) {
    for (const row of ctx.db
      .select({ id: view.id, name: view.name, logo: view.logo, project_id: view.project_id, project_name: project.name, project_archived: project.archived_at, project_deleted: project.deleted_at })
      .from(view)
      .leftJoin(project, eq(view.project_id, project.id))
      .where(and(inArray(view.id, viewIds), isNull(view.deleted_at)))
      .all()) {
      const projectLive = row.project_id === null || (row.project_deleted === null && row.project_archived === null);
      if (!projectLive) continue;
      found.set(`view:${row.id}`, {
        name: row.name,
        href: row.project_id === null ? `/workspace-views/${row.id}` : `/projects/${row.project_id}/views/${row.id}`,
        logo: row.logo,
        project_id: row.project_id,
        project_name: row.project_name,
      });
    }
  }
  const pageIds = idsOf(rows, "page");
  if (pageIds.length > 0) {
    for (const row of ctx.db
      .select({ id: page.id, name: page.name, logo: page.logo, project_id: page.project_id, project_name: project.name, project_archived: project.archived_at, project_deleted: project.deleted_at })
      .from(page)
      .leftJoin(project, eq(page.project_id, project.id))
      .where(and(inArray(page.id, pageIds), isNull(page.deleted_at), isNull(page.archived_at)))
      .all()) {
      const projectLive = row.project_id === null || (row.project_deleted === null && row.project_archived === null);
      if (!projectLive) continue;
      found.set(`page:${row.id}`, {
        name: row.name,
        href: `/pages/${row.id}`,
        logo: row.logo,
        project_id: row.project_id,
        project_name: row.project_name,
      });
    }
  }
  return found;
}

function liveFavorites(ctx: TesseraContext) {
  return ctx.db.select().from(favorite).where(isNull(favorite.deleted_at)).orderBy(asc(favorite.sort_order)).all();
}

function liveFolders(ctx: TesseraContext) {
  return ctx.db.select().from(favorite_folder).where(isNull(favorite_folder.deleted_at)).orderBy(asc(favorite_folder.sort_order)).all();
}

function toFavorite(row: typeof favorite.$inferSelect, entity: LiveEntity): FavoriteView {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    folder_id: row.folder_id,
    sort_order: row.sort_order,
    name: entity.name,
    href: entity.href,
    logo: entity.logo,
    project_id: entity.project_id,
    project_name: entity.project_name,
  };
}

export function listFavorites(ctx: TesseraContext): FavoritesTree {
  const rows = liveFavorites(ctx);
  const folders = liveFolders(ctx);
  const live = loadLive(ctx, rows);
  const visible = rows.flatMap((row) => {
    const entity = live.get(`${row.entity_type}:${row.entity_id}`);
    return entity ? [toFavorite(row, entity)] : [];
  });
  const folderIds = new Set(folders.map((folder) => folder.id));
  const byFolder = new Map<string, FavoriteView[]>();
  const topItems: FavoriteView[] = [];
  for (const item of visible) {
    if (item.folder_id !== null && folderIds.has(item.folder_id)) {
      const list = byFolder.get(item.folder_id) ?? [];
      list.push(item);
      byFolder.set(item.folder_id, list);
    } else {
      topItems.push(item);
    }
  }
  const folderViews: FavoritesTree["folders"] = folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    sort_order: folder.sort_order,
    items: (byFolder.get(folder.id) ?? []).sort((a, b) => (a.sort_order < b.sort_order ? -1 : a.sort_order > b.sort_order ? 1 : 0)),
  }));
  const order: FavoritesTree["order"] = [
    ...folders.map((folder) => ({ kind: "folder" as const, id: folder.id, sort_order: folder.sort_order })),
    ...topItems.map((item) => ({ kind: "favorite" as const, id: item.id, sort_order: item.sort_order })),
  ]
    .sort((a, b) => (a.sort_order < b.sort_order ? -1 : a.sort_order > b.sort_order ? 1 : 0))
    .map(({ kind, id }) => ({ kind, id }));
  return { folders: folderViews, items: topItems.sort((a, b) => (a.sort_order < b.sort_order ? -1 : 1)), order };
}

function requireLiveEntity(ctx: TesseraContext, entity_type: FavoriteEntityType, entity_id: string): LiveEntity {
  const entity = loadLive(ctx, [{ entity_type, entity_id }]).get(`${entity_type}:${entity_id}`);
  if (!entity) throw notFound(entity_type, entity_id);
  return entity;
}

function requireFolder(ctx: TesseraContext, folderId: string): FavoriteFolderView {
  const row = ctx.db
    .select()
    .from(favorite_folder)
    .where(and(eq(favorite_folder.id, folderId), isNull(favorite_folder.deleted_at)))
    .get();
  if (!row) throw notFound("favorite_folder", folderId);
  return { id: row.id, name: row.name, sort_order: row.sort_order };
}

function findLiveFavorite(ctx: TesseraContext, entity_type: FavoriteEntityType, entity_id: string) {
  return ctx.db
    .select()
    .from(favorite)
    .where(and(eq(favorite.entity_type, entity_type), eq(favorite.entity_id, entity_id), isNull(favorite.deleted_at)))
    .get();
}

function topLevelRows(ctx: TesseraContext): OrderedRow[] {
  const folders = liveFolders(ctx).map((row) => ({ id: row.id, sort_order: row.sort_order }));
  const items = liveFavorites(ctx)
    .filter((row) => row.folder_id === null)
    .map((row) => ({ id: row.id, sort_order: row.sort_order }));
  return [...folders, ...items].sort((a, b) => (a.sort_order < b.sort_order ? -1 : 1));
}

function folderRows(ctx: TesseraContext, folderId: string): OrderedRow[] {
  return liveFavorites(ctx)
    .filter((row) => row.folder_id === folderId)
    .map((row) => ({ id: row.id, sort_order: row.sort_order }));
}

function place(rows: OrderedRow[], id: string, beforeId: string | undefined, afterId: string | undefined, entity: string): string {
  if (beforeId === undefined && afterId === undefined) {
    const last = [...rows].filter((row) => row.id !== id).sort((a, b) => (a.sort_order < b.sort_order ? -1 : 1)).at(-1);
    return sortOrderAfter(last?.sort_order ?? null);
  }
  return sortOrderForMove(rows, id, beforeId, afterId, entity);
}

function levelKey(ctx: TesseraContext, folderId: string | null): string {
  const rows = folderId === null ? topLevelRows(ctx) : folderRows(ctx, folderId);
  return sortOrderAfter(lastOf(rows));
}

function lastOf(rows: OrderedRow[]): string | null {
  return rows.sort((a, b) => (a.sort_order < b.sort_order ? -1 : 1)).at(-1)?.sort_order ?? null;
}

export const AddFavoriteInput = z
  .object({
    entity_type: FavoriteEntityTypeSchema.describe("project, cycle, module, view or page."),
    entity_id: IdSchema.describe("Entity to favourite."),
    folder_id: IdSchema.nullable().optional().describe("Folder to place it in, or null for the top level."),
  })
  .strict();

export type AddFavoriteInputType = z.input<typeof AddFavoriteInput>;

export function addFavorite(ctx: TesseraContext, input: AddFavoriteInputType): FavoriteView {
  const data = validateInput(AddFavoriteInput, input);
  return withTx(ctx, () => {
    const entity = requireLiveEntity(ctx, data.entity_type, data.entity_id);
    if (data.folder_id) requireFolder(ctx, data.folder_id);
    if (findLiveFavorite(ctx, data.entity_type, data.entity_id)) throw conflict("Already a favourite", { conflict: "favorite_exists" });
    const now = ctx.now();
    const row = ctx.db
      .insert(favorite)
      .values({
        id: newId(),
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        folder_id: data.folder_id ?? null,
        sort_order: levelKey(ctx, data.folder_id ?? null),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: null, entity_type: "favorite", entity_id: row.id, verb: "created", new_identifier: entity.name });
    return toFavorite(row, entity);
  });
}

export const RemoveFavoriteInput = z
  .object({
    entity_type: FavoriteEntityTypeSchema.describe("project, cycle, module, view or page."),
    entity_id: IdSchema.describe("Entity to remove from favourites."),
  })
  .strict();

export type RemoveFavoriteInputType = z.input<typeof RemoveFavoriteInput>;

export function removeFavorite(ctx: TesseraContext, input: RemoveFavoriteInputType): void {
  const data = validateInput(RemoveFavoriteInput, input);
  withTx(ctx, () => {
    const row = findLiveFavorite(ctx, data.entity_type, data.entity_id);
    if (!row) throw notFound("favorite", data.entity_id);
    const now = ctx.now();
    ctx.db
      .update(favorite)
      .set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(favorite.id, row.id))
      .run();
    logActivity(ctx, { project_id: null, entity_type: "favorite", entity_id: row.id, verb: "deleted" });
  });
}

const MoveEnds = {
  before_id: IdSchema.optional().describe("Sibling that will come directly before this row."),
  after_id: IdSchema.optional().describe("Sibling that will come directly after this row."),
};

export const MoveFavoriteInput = z
  .object({
    favorite_id: IdSchema.describe("Favourite to move."),
    folder_id: IdSchema.nullable().describe("Folder to move into, or null for the top level."),
    ...MoveEnds,
  })
  .strict();

export type MoveFavoriteInputType = z.input<typeof MoveFavoriteInput>;

export function moveFavorite(ctx: TesseraContext, input: MoveFavoriteInputType): FavoriteView {
  const data = validateInput(MoveFavoriteInput, input);
  return withTx(ctx, () => {
    const before = ctx.db.select().from(favorite).where(and(eq(favorite.id, data.favorite_id), isNull(favorite.deleted_at))).get();
    if (!before) throw notFound("favorite", data.favorite_id);
    const entity = requireLiveEntity(ctx, before.entity_type, before.entity_id);
    if (data.folder_id) requireFolder(ctx, data.folder_id);
    const siblings = data.folder_id === null ? topLevelRows(ctx) : folderRows(ctx, data.folder_id);
    const sort_order = place(siblings, before.id, data.before_id, data.after_id, data.folder_id === null ? "favorite" : "favorite");
    const now = ctx.now();
    const after = ctx.db
      .update(favorite)
      .set({ folder_id: data.folder_id, sort_order, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(favorite.id, before.id))
      .returning()
      .get();
    if (before.folder_id !== after.folder_id || before.sort_order !== after.sort_order) {
      logActivity(ctx, {
        project_id: null,
        entity_type: "favorite",
        entity_id: before.id,
        verb: "moved",
        field: before.folder_id !== after.folder_id ? "folder_id" : "sort_order",
      });
    }
    return toFavorite(after, entity);
  });
}

export const CreateFavoriteFolderInput = z.object({ name: FOLDER_NAME.describe("Folder name. Names need not be unique.") }).strict();

export type CreateFavoriteFolderInputType = z.input<typeof CreateFavoriteFolderInput>;

export function createFavoriteFolder(ctx: TesseraContext, input: CreateFavoriteFolderInputType): FavoriteFolderView {
  const data = validateInput(CreateFavoriteFolderInput, input);
  return withTx(ctx, () => {
    const now = ctx.now();
    const row = ctx.db
      .insert(favorite_folder)
      .values({
        id: newId(),
        name: data.name,
        sort_order: sortOrderAfter(lastOf(topLevelRows(ctx))),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: null, entity_type: "favorite_folder", entity_id: row.id, verb: "created", new_identifier: row.name });
    return { id: row.id, name: row.name, sort_order: row.sort_order };
  });
}

export const RenameFavoriteFolderInput = z
  .object({
    folder_id: IdSchema.describe("Folder to rename."),
    name: FOLDER_NAME.describe("New folder name."),
  })
  .strict();

export type RenameFavoriteFolderInputType = z.input<typeof RenameFavoriteFolderInput>;

export function renameFavoriteFolder(ctx: TesseraContext, input: RenameFavoriteFolderInputType): FavoriteFolderView {
  const data = validateInput(RenameFavoriteFolderInput, input);
  return withTx(ctx, () => {
    const before = requireFolder(ctx, data.folder_id);
    const now = ctx.now();
    const after = ctx.db
      .update(favorite_folder)
      .set({ name: data.name, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(favorite_folder.id, data.folder_id))
      .returning()
      .get();
    diffFields(ctx, { project_id: null, entity_type: "favorite_folder", entity_id: before.id }, { name: before.name }, { name: after.name }, ["name"]);
    return { id: after.id, name: after.name, sort_order: after.sort_order };
  });
}

export const MoveFavoriteFolderInput = z
  .object({
    folder_id: IdSchema.describe("Folder to move at the top level."),
    ...MoveEnds,
  })
  .strict();

export type MoveFavoriteFolderInputType = z.input<typeof MoveFavoriteFolderInput>;

export function moveFavoriteFolder(ctx: TesseraContext, input: MoveFavoriteFolderInputType): FavoriteFolderView {
  const data = validateInput(MoveFavoriteFolderInput, input);
  return withTx(ctx, () => {
    const before = requireFolder(ctx, data.folder_id);
    const sort_order = place(topLevelRows(ctx), before.id, data.before_id, data.after_id, "favorite_folder");
    const now = ctx.now();
    const after = ctx.db
      .update(favorite_folder)
      .set({ sort_order, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(favorite_folder.id, before.id))
      .returning()
      .get();
    if (before.sort_order !== after.sort_order) {
      logActivity(ctx, { project_id: null, entity_type: "favorite_folder", entity_id: before.id, verb: "moved", field: "sort_order" });
    }
    return { id: after.id, name: after.name, sort_order: after.sort_order };
  });
}

export const DeleteFavoriteFolderInput = z.object({ folder_id: IdSchema.describe("Folder to delete. Its favourites move to the top level.") }).strict();

export type DeleteFavoriteFolderInputType = z.input<typeof DeleteFavoriteFolderInput>;

export function deleteFavoriteFolder(ctx: TesseraContext, input: DeleteFavoriteFolderInputType): void {
  const data = validateInput(DeleteFavoriteFolderInput, input);
  withTx(ctx, () => {
    requireFolder(ctx, data.folder_id);
    const now = ctx.now();
    const children = liveFavorites(ctx).filter((row) => row.folder_id === data.folder_id);
    let cursor = lastOf(topLevelRows(ctx).filter((row) => row.id !== data.folder_id));
    for (const child of children) {
      cursor = sortOrderAfter(cursor);
      ctx.db
        .update(favorite)
        .set({ folder_id: null, sort_order: cursor, updated_at: now, updated_by: ctx.actor.id })
        .where(eq(favorite.id, child.id))
        .run();
      logActivity(ctx, { project_id: null, entity_type: "favorite", entity_id: child.id, verb: "moved", field: "folder_id" });
    }
    ctx.db
      .update(favorite_folder)
      .set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(favorite_folder.id, data.folder_id))
      .run();
    logActivity(ctx, { project_id: null, entity_type: "favorite_folder", entity_id: data.folder_id, verb: "deleted" });
  });
}

export function isFavorite(ctx: TesseraContext, entity_type: FavoriteEntityType, entity_id: string): boolean {
  return findLiveFavorite(ctx, entity_type, entity_id) !== undefined;
}

export function favoriteIds(ctx: TesseraContext, entity_type: FavoriteEntityType): Set<string> {
  const rows = ctx.db
    .select({ entity_id: favorite.entity_id })
    .from(favorite)
    .where(and(eq(favorite.entity_type, entity_type), isNull(favorite.deleted_at)))
    .all();
  return new Set(rows.map((row) => row.entity_id));
}
