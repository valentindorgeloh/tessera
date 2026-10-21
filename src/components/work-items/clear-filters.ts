/**
 * "Clear filters" of the no-results state (docs/contracts/ui.md "Work items
 * screen"): which filters count as active and the `q` state that removes them
 * the way the filter bar does. The bar's tokens and "Clear" write the simple
 * filters with explicit empty values (./filter-state.ts); its Advanced chip
 * writes `rich_filters: null`. Pure and client-safe.
 */
import type { Filters, RichFilters } from "@/lib/tessera/types";
import { DATE_FIELDS, LIST_FIELDS, withExplicitClears } from "./filter-state";
import type { UrlState } from "./types";

/** True while the filter bar shows a token (search, a list or date filter) or an Advanced tree applies. */
export function hasActiveFilters(filters: Filters, richFilters: RichFilters | null | undefined): boolean {
  if (richFilters) return true;
  if (filters.search && filters.search.trim() !== "") return true;
  if (LIST_FIELDS.some((field) => (filters[field]?.length ?? 0) > 0)) return true;
  return DATE_FIELDS.some((field) => filters[field] !== undefined);
}

/**
 * `urlState` with every filter the bar manages cleared and the Advanced tree dropped (`null` overrides a saved
 * view's tree for this listing, decision 32). The display half stays.
 */
export function clearedUrlState(urlState: UrlState, filters: Filters, richFilters: RichFilters | null | undefined): UrlState {
  const state: UrlState = {};
  if (urlState.display) state.display = urlState.display;
  const cleared = withExplicitClears(filters, {});
  if (Object.keys(cleared).length > 0) state.filters = cleared;
  if (richFilters) state.rich_filters = null;
  return state;
}
