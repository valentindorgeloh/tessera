/**
 * When the work items filter row (the filter field and "Advanced") is drawn
 * (docs/contracts/ui.md "Work items screen"): while a filter, a search text or an
 * Advanced tree applies it cannot be hidden, a saved view's own bar lives in it, and
 * otherwise only the Filter button's toggle shows it. Pure and client-safe.
 */
import type { Filters, RichFilters } from "@/lib/tessera/types";
import { hasActiveFilters } from "./clear-filters";

/** True when the row must stay: filters apply, or a bar that lives in the row (a saved view's) is passed. */
export function filterRowForced(filters: Filters, richFilters: RichFilters | null | undefined, hasRowEnd: boolean): boolean {
  return hasRowEnd || hasActiveFilters(filters, richFilters);
}

/** The row shows when it is forced or the person toggled it open. */
export function filterRowShown(forced: boolean, toggledOpen: boolean): boolean {
  return forced || toggledOpen;
}
