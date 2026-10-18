"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import type { FavoriteEntityType } from "@/lib/tessera/types";
import { EMPTY_FAVORITES, isFavoriteInTree, type FavoritesTree } from "./tree";
import { readFavoritesTree, subscribeFavorites, writeFavoritesTree } from "./state";

function getServerSnapshot(): FavoritesTree {
  return EMPTY_FAVORITES;
}

/** Publishes the layout's favourites tree for header stars and Power K. */
export function FavoritesPublisher({ tree }: { tree: FavoritesTree }) {
  useLayoutEffect(() => {
    writeFavoritesTree(tree);
  }, [tree]);
  return null;
}

export function useFavoritesTree(): FavoritesTree {
  return useSyncExternalStore(subscribeFavorites, readFavoritesTree, getServerSnapshot);
}

export function useIsFavorite(entityType: FavoriteEntityType, entityId: string): boolean {
  return isFavoriteInTree(useFavoritesTree(), entityType, entityId);
}
