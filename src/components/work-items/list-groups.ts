/**
 * Which groups the list layout draws (docs/contracts/ui.md "Work items screen"). Pure and shared by ListLayout, which
 * draws them, and WorkItemsScreen, which marks the scroller while bands are on screen.
 */
import type { Display, Group, WorkItemListResult } from "@/lib/tessera/types";

/** The groups the list draws (empty ones only with "show empty groups"); null while it is ungrouped. */
export function visibleGroups(result: WorkItemListResult, display: Display): Group[] | null {
  return display.group_by && result.groups ? result.groups.filter((group) => display.show_empty_groups || group.count > 0) : null;
}

/**
 * While a filter applies and nothing matches, every group is empty too ("show empty groups" lists them with a quick-add
 * row each): the list shows the same no-results state as the flat list instead.
 */
export function nothingMatches(result: WorkItemListResult, groups: readonly Group[] | null, hasFilters: boolean): boolean {
  return result.items.length === 0 && hasFilters && (groups === null || groups.every((group) => group.count === 0));
}

/**
 * Whether the list draws group bands. WorkItemsScreen puts `tessera-wi-scroller--grouped` on the scroller exactly
 * then, which carries the scroll padding that keeps focus clear of a sticky band (work-items.css); it replaced a
 * `:has(.tessera-wi-group)` rule that made the browser re-check the scroller's whole subtree (decision 141).
 */
export function listShowsGroups(result: WorkItemListResult, display: Display, hasFilters: boolean): boolean {
  const groups = visibleGroups(result, display);
  return groups !== null && groups.length > 0 && !nothingMatches(result, groups, hasFilters);
}
