"use server";

/**
 * Favourite mutations (docs/drafts/p9-plan.md U2). One wrapper per registry
 * tool. Reads stay in the layout's `readTessera`. When a name is not in the
 * registry yet, the wrapper still calls `toolAction` and, if that throws at
 * load, returns the tool's absence as `{ ok: false }` so the shell keeps
 * rendering.
 */
import type { FavoriteEntityType } from "@/lib/tessera/types";
import { toolAction, type ActionResult } from "./_run";

export type AddFavoriteInput = {
  entity_type: FavoriteEntityType;
  entity_id: string;
  folder_id?: string | null;
};

export type RemoveFavoriteInput = {
  entity_type: FavoriteEntityType;
  entity_id: string;
};

export type MoveFavoriteInput = {
  favorite_id: string;
  folder_id: string | null;
  before_id?: string;
  after_id?: string;
};

export type CreateFavoriteFolderInput = { name: string };

export type RenameFavoriteFolderInput = { folder_id: string; name: string };

export type MoveFavoriteFolderInput = {
  folder_id: string;
  before_id?: string;
  after_id?: string;
};

export type DeleteFavoriteFolderInput = { folder_id: string };

type ToolCaller = Parameters<typeof toolAction>[0];

function bind<T>(name: string): (input: T) => Promise<ActionResult> {
  try {
    return toolAction(name as unknown as ToolCaller) as (input: T) => Promise<ActionResult>;
  } catch (err) {
    const message = err instanceof Error ? err.message : `Tool ${name} is not registered`;
    return async () => ({ ok: false, code: "NOT_FOUND", message });
  }
}

export const listFavoritesAction = bind<Record<string, never>>("list_favorites");
export const addFavoriteAction = bind<AddFavoriteInput>("add_favorite");
export const removeFavoriteAction = bind<RemoveFavoriteInput>("remove_favorite");
export const moveFavoriteAction = bind<MoveFavoriteInput>("move_favorite");
export const createFavoriteFolderAction = bind<CreateFavoriteFolderInput>("create_favorite_folder");
export const renameFavoriteFolderAction = bind<RenameFavoriteFolderInput>("rename_favorite_folder");
export const moveFavoriteFolderAction = bind<MoveFavoriteFolderInput>("move_favorite_folder");
export const deleteFavoriteFolderAction = bind<DeleteFavoriteFolderInput>("delete_favorite_folder");
