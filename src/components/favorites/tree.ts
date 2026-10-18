/**
 * Favourites tree for the sidebar (docs/drafts/p9-plan.md U2). Pure: the
 * shape `listFavorites` returns, the moves the menus and the drag send, and
 * the optimistic tree those moves produce. No React, so Vitest covers it
 * (tests/ui/favorites-tree.test.ts).
 *
 * Placement matches the engine's fractional keys: `before_id` is the sibling
 * that ends up directly before the moved row, `after_id` the one directly
 * after. At the top level those siblings mix folders and unfoldered
 * favourites; inside a folder they are favourites.
 */
import type { FavoriteEntityType, Logo } from "@/lib/tessera/types";
import { projectIdFromPath } from "@/components/shell/recents";

export type FavoriteFolderView = {
  id: string;
  name: string;
  sort_order: string;
};

export type FavoriteView = {
  id: string;
  entity_type: FavoriteEntityType;
  entity_id: string;
  folder_id: string | null;
  sort_order: string;
  name: string;
  href: string;
  logo: Logo | null;
  project_id: string | null;
  project_name: string | null;
};

export type FavoriteOrderSlot = { kind: "folder"; id: string } | { kind: "favorite"; id: string };

/** Top level mixes folders and unfoldered favourites in `order`; each folder lists its own favourites. */
export type FavoritesTree = {
  folders: (FavoriteFolderView & { items: FavoriteView[] })[];
  items: FavoriteView[];
  order: FavoriteOrderSlot[];
};

export const EMPTY_FAVORITES: FavoritesTree = { folders: [], items: [], order: [] };

export type Placement = { before_id?: string; after_id?: string };

export type FavoriteMove =
  | { kind: "favorite"; favorite_id: string; folder_id: string | null; before_id?: string; after_id?: string }
  | { kind: "folder"; folder_id: string; before_id?: string; after_id?: string };

export type TopEntry = { kind: "folder"; folder: FavoriteFolderView; items: FavoriteView[] } | { kind: "favorite"; favorite: FavoriteView };

/** Static workspace views cannot be favourited. */
const STATIC_VIEW_KEYS = new Set(["all", "assigned", "created", "subscribed"]);

/** Top-level rows in `order`, skipping ids the tree does not hold. */
export function topEntries(tree: FavoritesTree): TopEntry[] {
  const folders = new Map(tree.folders.map((folder) => [folder.id, folder]));
  const items = new Map(tree.items.map((item) => [item.id, item]));
  const entries: TopEntry[] = [];
  for (const slot of tree.order) {
    if (slot.kind === "folder") {
      const folder = folders.get(slot.id);
      if (folder) entries.push({ kind: "folder", folder, items: folder.items });
    } else {
      const favorite = items.get(slot.id);
      if (favorite) entries.push({ kind: "favorite", favorite });
    }
  }
  return entries;
}

export function isFavoritesEmpty(tree: FavoritesTree): boolean {
  return topEntries(tree).length === 0;
}

/** True when a live favourite row points at this entity. */
export function isFavoriteInTree(tree: FavoritesTree, entityType: FavoriteEntityType, entityId: string): boolean {
  const matches = (item: FavoriteView) => item.entity_type === entityType && item.entity_id === entityId;
  if (tree.items.some(matches)) return true;
  return tree.folders.some((folder) => folder.items.some(matches));
}

function findFavorite(tree: FavoritesTree, favoriteId: string): FavoriteView | null {
  return tree.items.find((item) => item.id === favoriteId) ?? tree.folders.flatMap((folder) => folder.items).find((item) => item.id === favoriteId) ?? null;
}

/** Ids of the siblings at one level: the top-level order, or one folder's favourites. */
export function siblingIds(tree: FavoritesTree, folderId: string | null): string[] {
  if (folderId === null) return tree.order.map((slot) => slot.id);
  return tree.folders.find((folder) => folder.id === folderId)?.items.map((item) => item.id) ?? [];
}

/**
 * Move one step in `ids`. Up sits directly before the previous id (`after_id`);
 * down sits directly after the next id (`before_id`). Null at the ends and for an unknown id.
 */
export function stepPlacement(ids: readonly string[], id: string, direction: "up" | "down"): Placement | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  if (direction === "up") {
    if (index === 0) return null;
    return { after_id: ids[index - 1] };
  }
  if (index >= ids.length - 1) return null;
  return { before_id: ids[index + 1] };
}

/** Place `id` after `before_id` and/or before `after_id`. An unknown neighbour leaves the list unchanged. */
export function reorderIds(ids: readonly string[], id: string, placement: Placement): string[] {
  if (!ids.includes(id)) return [...ids];
  const rest = ids.filter((entry) => entry !== id);
  if (placement.before_id !== undefined) {
    const index = rest.indexOf(placement.before_id);
    if (index < 0) return [...ids];
    const next = [...rest];
    next.splice(index + 1, 0, id);
    return next;
  }
  if (placement.after_id !== undefined) {
    const index = rest.indexOf(placement.after_id);
    if (index < 0) return [...ids];
    const next = [...rest];
    next.splice(index, 0, id);
    return next;
  }
  return [...ids];
}

/** Same placement as `reorderIds`, for rows that carry an id. */
export function reorderByPlacement<T extends { id: string }>(rows: readonly T[], id: string, placement: Placement): T[] {
  const order = reorderIds(rows.map((row) => row.id), id, placement);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return order.flatMap((entry) => {
    const row = byId.get(entry);
    return row ? [row] : [];
  });
}

/** Append placement: directly after the last sibling, or none when the level is empty. */
export function appendPlacement(ids: readonly string[]): Placement {
  const last = ids[ids.length - 1];
  return last === undefined ? {} : { before_id: last };
}

/** One step for a top-level row or a favourite inside its folder. */
export function stepFavorite(tree: FavoritesTree, id: string, direction: "up" | "down"): FavoriteMove | null {
  const top = siblingIds(tree, null);
  if (top.includes(id)) {
    const placement = stepPlacement(top, id, direction);
    if (!placement) return null;
    const slot = tree.order.find((entry) => entry.id === id);
    if (slot?.kind === "folder") return { kind: "folder", folder_id: id, ...placement };
    return { kind: "favorite", favorite_id: id, folder_id: null, ...placement };
  }
  for (const folder of tree.folders) {
    const ids = folder.items.map((item) => item.id);
    if (!ids.includes(id)) continue;
    const placement = stepPlacement(ids, id, direction);
    if (!placement) return null;
    return { kind: "favorite", favorite_id: id, folder_id: folder.id, ...placement };
  }
  return null;
}

/** Move a favourite to the end of a folder, or to the end of the top level when `folderId` is null. */
export function moveFavoriteToLevel(tree: FavoritesTree, favoriteId: string, folderId: string | null): FavoriteMove | null {
  const favorite = findFavorite(tree, favoriteId);
  if (!favorite) return null;
  if (folderId !== null && !tree.folders.some((folder) => folder.id === folderId)) return null;
  const siblings = siblingIds(tree, folderId).filter((id) => id !== favoriteId);
  return { kind: "favorite", favorite_id: favoriteId, folder_id: folderId, ...appendPlacement(siblings) };
}

function withoutFavorite(tree: FavoritesTree, favoriteId: string): FavoritesTree {
  return {
    folders: tree.folders.map((folder) => ({ ...folder, items: folder.items.filter((item) => item.id !== favoriteId) })),
    items: tree.items.filter((item) => item.id !== favoriteId),
    order: tree.order.filter((slot) => !(slot.kind === "favorite" && slot.id === favoriteId)),
  };
}

/** The tree after a move, for `useOptimistic`. An unknown id leaves the tree as it was. */
export function applyFavoriteMove(tree: FavoritesTree, move: FavoriteMove): FavoritesTree {
  if (move.kind === "folder") {
    const ids = reorderIds(siblingIds(tree, null), move.folder_id, move);
    if (ids.join("\0") === siblingIds(tree, null).join("\0")) return tree;
    const slots = new Map(tree.order.map((slot) => [slot.id, slot]));
    return { ...tree, order: ids.flatMap((id) => {
      const slot = slots.get(id);
      return slot ? [slot] : [];
    }) };
  }
  const favorite = findFavorite(tree, move.favorite_id);
  if (!favorite) return tree;
  const next = withoutFavorite(tree, favorite.id);
  const placed: FavoriteView = { ...favorite, folder_id: move.folder_id };
  if (move.folder_id === null) {
    const ids = reorderIds([...siblingIds(next, null), favorite.id], favorite.id, move);
    const slots = new Map<string, FavoriteOrderSlot>(next.order.map((slot) => [slot.id, slot]));
    slots.set(favorite.id, { kind: "favorite", id: favorite.id });
    return {
      folders: next.folders,
      items: [...next.items, placed],
      order: ids.flatMap((id) => {
        const slot = slots.get(id);
        return slot ? [slot] : [];
      }),
    };
  }
  return {
    ...next,
    folders: next.folders.map((folder) => {
      if (folder.id !== move.folder_id) return folder;
      const ids = reorderIds([...folder.items.map((item) => item.id), favorite.id], favorite.id, move);
      const byId = new Map([...folder.items, placed].map((item) => [item.id, item]));
      return {
        ...folder,
        items: ids.flatMap((id) => {
          const item = byId.get(id);
          return item ? [item] : [];
        }),
      };
    }),
  };
}

/**
 * Deleting a folder appends its favourites to the top level. The folder row
 * itself goes away; the favourites stay.
 */
export function dropFolder(tree: FavoritesTree, folderId: string): FavoritesTree {
  const folder = tree.folders.find((entry) => entry.id === folderId);
  if (!folder) return tree;
  const released = folder.items.map((item) => ({ ...item, folder_id: null }));
  return {
    folders: tree.folders.filter((entry) => entry.id !== folderId),
    items: [...tree.items, ...released],
    order: [
      ...tree.order.filter((slot) => !(slot.kind === "folder" && slot.id === folderId)),
      ...released.map((item) => ({ kind: "favorite" as const, id: item.id })),
    ],
  };
}

/**
 * The entity Power K can favourite from a path: a page, cycle, module or view
 * when the route names one, otherwise the project. Static view keys and the
 * archived-projects page are not entities.
 */
export function favoriteTarget(pathname: string): { entity_type: FavoriteEntityType; entity_id: string } | null {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  const page = /^\/pages\/([^/]+)$/.exec(path);
  if (page?.[1]) return { entity_type: "page", entity_id: decodeURIComponent(page[1]) };
  const projectPage = /^\/projects\/([^/]+)\/pages\/([^/]+)$/.exec(path);
  if (projectPage?.[2] && projectPage[1] !== "archives") return { entity_type: "page", entity_id: decodeURIComponent(projectPage[2]) };
  const cycle = /^\/projects\/([^/]+)\/cycles\/([^/]+)$/.exec(path);
  if (cycle?.[2] && cycle[1] !== "archives") return { entity_type: "cycle", entity_id: decodeURIComponent(cycle[2]) };
  const moduleRoute = /^\/projects\/([^/]+)\/modules\/([^/]+)$/.exec(path);
  if (moduleRoute?.[2] && moduleRoute[1] !== "archives") return { entity_type: "module", entity_id: decodeURIComponent(moduleRoute[2]) };
  const view = /^\/projects\/([^/]+)\/views\/([^/]+)$/.exec(path);
  if (view?.[2] && view[1] !== "archives" && !STATIC_VIEW_KEYS.has(view[2])) return { entity_type: "view", entity_id: decodeURIComponent(view[2]) };
  const workspaceView = /^\/workspace-views\/([^/]+)$/.exec(path);
  if (workspaceView?.[1] && !STATIC_VIEW_KEYS.has(workspaceView[1])) return { entity_type: "view", entity_id: decodeURIComponent(workspaceView[1]) };
  const projectId = projectIdFromPath(path);
  if (projectId) return { entity_type: "project", entity_id: projectId };
  return null;
}
