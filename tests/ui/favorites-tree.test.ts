import { describe, expect, it } from "vitest";
import {
  applyFavoriteMove,
  dropFolder,
  favoriteTarget,
  isFavoriteInTree,
  reorderByPlacement,
  reorderIds,
  stepFavorite,
  stepPlacement,
  topEntries,
  type FavoriteView,
  type FavoritesTree,
} from "@/components/favorites/tree";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const CYCLE = "33333333-3333-7333-8333-333333333333";
const PAGE = "66666666-6666-7666-8666-666666666666";

function favorite(id: string, folderId: string | null = null): FavoriteView {
  return {
    id,
    entity_type: "page",
    entity_id: id,
    folder_id: folderId,
    sort_order: id,
    name: id,
    href: `/pages/${id}`,
    logo: null,
    project_id: null,
    project_name: null,
  };
}

function tree(): FavoritesTree {
  return {
    folders: [
      { id: "folder-a", name: "A", sort_order: "a", items: [favorite("d", "folder-a"), favorite("e", "folder-a")] },
      { id: "folder-c", name: "C", sort_order: "c", items: [favorite("f", "folder-c")] },
    ],
    items: [favorite("b")],
    order: [
      { kind: "folder", id: "folder-a" },
      { kind: "favorite", id: "b" },
      { kind: "folder", id: "folder-c" },
    ],
  };
}

describe("topEntries", () => {
  it("follows order and keeps each folder's favourites", () => {
    const entries = topEntries(tree());
    expect(entries.map((entry) => (entry.kind === "folder" ? entry.folder.id : entry.favorite.id))).toEqual(["folder-a", "b", "folder-c"]);
    expect(entries[0]?.kind === "folder" ? entries[0].items.map((item) => item.id) : []).toEqual(["d", "e"]);
  });
});

describe("placement", () => {
  it("steps up before the previous sibling and down after the next", () => {
    expect(stepPlacement(["a", "b", "c"], "c", "up")).toEqual({ after_id: "b" });
    expect(stepPlacement(["a", "b", "c"], "a", "down")).toEqual({ before_id: "b" });
    expect(stepPlacement(["a", "b", "c"], "a", "up")).toBeNull();
    expect(stepPlacement(["a", "b", "c"], "c", "down")).toBeNull();
    expect(reorderIds(["a", "b", "c"], "c", { after_id: "b" })).toEqual(["a", "c", "b"]);
    expect(reorderIds(["a", "b", "c"], "a", { before_id: "b" })).toEqual(["b", "a", "c"]);
  });

  it("reorders rows with the same placement", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(reorderByPlacement(rows, "a", { before_id: "b" }).map((row) => row.id)).toEqual(["b", "a", "c"]);
  });
});

describe("stepFavorite", () => {
  it("moves a favourite inside its folder and a folder among the top level", () => {
    expect(stepFavorite(tree(), "d", "down")).toEqual({ kind: "favorite", favorite_id: "d", folder_id: "folder-a", before_id: "e" });
    expect(stepFavorite(tree(), "e", "up")).toEqual({ kind: "favorite", favorite_id: "e", folder_id: "folder-a", after_id: "d" });
    expect(stepFavorite(tree(), "folder-a", "down")).toEqual({ kind: "folder", folder_id: "folder-a", before_id: "b" });
    expect(stepFavorite(tree(), "d", "up")).toBeNull();
  });

  it("applies a move into a folder and back to the top", () => {
    const into = applyFavoriteMove(tree(), { kind: "favorite", favorite_id: "b", folder_id: "folder-a", before_id: "e" });
    const folder = into.folders.find((entry) => entry.id === "folder-a");
    expect(folder?.items.map((item) => item.id)).toEqual(["d", "e", "b"]);
    expect(into.items).toEqual([]);
    expect(into.order.map((slot) => slot.id)).toEqual(["folder-a", "folder-c"]);
    const back = applyFavoriteMove(into, { kind: "favorite", favorite_id: "b", folder_id: null, before_id: "folder-c" });
    expect(back.items.map((item) => item.id)).toEqual(["b"]);
    expect(back.order.map((slot) => slot.id)).toEqual(["folder-a", "folder-c", "b"]);
    expect(isFavoriteInTree(back, "page", "b")).toBe(true);
  });
});

describe("dropFolder", () => {
  it("appends the folder's favourites to the top level", () => {
    const next = dropFolder(tree(), "folder-a");
    expect(next.folders.map((folder) => folder.id)).toEqual(["folder-c"]);
    expect(next.items.map((item) => item.id)).toEqual(["b", "d", "e"]);
    expect(next.order.map((slot) => slot.id)).toEqual(["b", "folder-c", "d", "e"]);
    expect(next.items.every((item) => item.folder_id === null || item.id === "b")).toBe(true);
  });
});

describe("favoriteTarget", () => {
  it("names the entity on the path and skips archives and static views", () => {
    expect(favoriteTarget(`/projects/${PROJECT}/cycles/${CYCLE}`)).toEqual({ entity_type: "cycle", entity_id: CYCLE });
    expect(favoriteTarget(`/projects/${PROJECT}/modules/${CYCLE}`)).toEqual({ entity_type: "module", entity_id: CYCLE });
    expect(favoriteTarget(`/projects/${PROJECT}/views/${PAGE}`)).toEqual({ entity_type: "view", entity_id: PAGE });
    expect(favoriteTarget(`/pages/${PAGE}`)).toEqual({ entity_type: "page", entity_id: PAGE });
    expect(favoriteTarget(`/projects/${PROJECT}/work-items`)).toEqual({ entity_type: "project", entity_id: PROJECT });
    expect(favoriteTarget("/projects/archives")).toBeNull();
    expect(favoriteTarget("/workspace-views/all")).toBeNull();
    expect(favoriteTarget(`/workspace-views/${PAGE}`)).toEqual({ entity_type: "view", entity_id: PAGE });
    expect(favoriteTarget("/")).toBeNull();
  });
});
