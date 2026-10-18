/**
 * The favourites tree the sidebar published, readable from Power K without
 * React. The server snapshot stays empty; the client copy arrives in a
 * layout effect (./store.tsx) so the first render matches the server.
 */
import { EMPTY_FAVORITES, type FavoritesTree } from "./tree";

let current: FavoritesTree = EMPTY_FAVORITES;
const listeners = new Set<() => void>();

export function readFavoritesTree(): FavoritesTree {
  return current;
}

export function writeFavoritesTree(next: FavoritesTree): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test and navigation reset. The shell does not call this. */
export function resetFavoritesTree(): void {
  current = EMPTY_FAVORITES;
  for (const listener of listeners) listener();
}
