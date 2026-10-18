import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { latestSeq } from "@/lib/tessera/activity";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { archiveProject, createProject, unarchiveProject } from "@/lib/tessera/projects";
import { createCycle } from "@/lib/tessera/cycles";
import { archiveModule, createModule, unarchiveModule, updateModule } from "@/lib/tessera/modules";
import {
  addFavorite,
  createFavoriteFolder,
  deleteFavoriteFolder,
  listFavorites,
  moveFavorite,
  removeFavorite,
} from "@/lib/tessera/workspace";
import { createWorkItem, deleteWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "../helpers/db";

function ctxOf(handles: DbHandles): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => "2026-10-18" });
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

describe("favourites", () => {
  it("allows one live favourite per entity and keeps favourites when a folder is deleted", () => {
    const ctx = ctxOf(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const cycle = createCycle(ctx, { project_id: project.id, name: "Now", start_date: "2026-10-01", end_date: "2026-10-31" });
    addFavorite(ctx, { entity_type: "project", entity_id: project.id });
    expect(errorCode(() => addFavorite(ctx, { entity_type: "project", entity_id: project.id }))).toBe("CONFLICT");
    const cycleFavorite = addFavorite(ctx, { entity_type: "cycle", entity_id: cycle.id });
    const folder = createFavoriteFolder(ctx, { name: "Planning" });
    moveFavorite(ctx, { favorite_id: cycleFavorite.id, folder_id: folder.id });
    expect(listFavorites(ctx).folders[0]?.items.map((item) => item.entity_id)).toEqual([cycle.id]);
    deleteFavoriteFolder(ctx, { folder_id: folder.id });
    const tree = listFavorites(ctx);
    expect(tree.folders).toEqual([]);
    expect(tree.items.map((item) => item.entity_id).sort()).toEqual([cycle.id, project.id].sort());
  });

  it("hides favourites of archived or deleted entities and of archived projects", () => {
    const ctx = ctxOf(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const auth = createModule(ctx, { project_id: project.id, name: "Auth" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    addFavorite(ctx, { entity_type: "project", entity_id: project.id });
    addFavorite(ctx, { entity_type: "module", entity_id: auth.id });
    updateModule(ctx, auth.id, { status: "completed" });
    archiveModule(ctx, auth.id);
    expect(listFavorites(ctx).items.map((row) => row.entity_id)).toEqual([project.id]);
    unarchiveModule(ctx, auth.id);
    expect(listFavorites(ctx).items.map((row) => row.entity_id).sort()).toEqual([auth.id, project.id].sort());
    archiveProject(ctx, project.id);
    expect(listFavorites(ctx).items).toEqual([]);
    unarchiveProject(ctx, project.id);
    expect(listFavorites(ctx).items).toHaveLength(2);
    deleteWorkItem(ctx, item.id);
    expect(errorCode(() => addFavorite(ctx, { entity_type: "project", entity_id: item.id }))).toBe("NOT_FOUND");
    removeFavorite(ctx, { entity_type: "project", entity_id: project.id });
    expect(errorCode(() => removeFavorite(ctx, { entity_type: "project", entity_id: project.id }))).toBe("NOT_FOUND");
    expect(latestSeq(ctx)).toBeGreaterThan(0);
  });
});
