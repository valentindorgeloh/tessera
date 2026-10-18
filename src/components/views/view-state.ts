/**
 * Pure helpers of saved views (docs/contracts/ui.md "Views"): what counts as
 * a change to a view (decision 32), the quick-add defaults a view's filters
 * imply and the one-line summary of a view row. Directive-free and client-safe
 * (types only from the engine), so Vitest covers it (tests/ui/view-state.test.ts).
 */
import type { Display, Filters, Layout, RichFilters, View } from "@/lib/tessera/types";
import { GROUP_LABELS } from "@/components/work-items/display-options";
import type { ScopeDefaults } from "@/components/work-items/types";

export type ViewState = { filters: Filters; display: Display; rich_filters?: RichFilters | null };

const LAYOUT_LABELS: Record<Layout, string> = { list: "List", board: "Board", table: "Table", calendar: "Calendar", gantt: "Gantt" };

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Drops keys whose value is undefined, null, "" or []; sorts every string array (filters are "any of" sets). */
export function normalizeFilters(filters: Filters): Filters {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (isEmptyValue(value)) continue;
    out[key] = Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value].sort() : value;
  }
  return out as Filters;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
    return sorted;
  }
  return value;
}

/** JSON with object keys sorted at every level; arrays keep their order (after normalizeFilters). */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** True when the effective state differs from the saved one (decision 32). Both displays are complete. */
export function isViewModified(saved: ViewState, effective: ViewState): boolean {
  return (
    stableJson(normalizeFilters(saved.filters)) !== stableJson(normalizeFilters(effective.filters)) ||
    stableJson(saved.display) !== stableJson(effective.display) ||
    stableJson(saved.rich_filters ?? null) !== stableJson(effective.rich_filters ?? null)
  );
}

/** Quick-add and dialog defaults implied by a view's filters. */
export function viewScopeDefaults(filters: Filters): ScopeDefaults {
  const normalized = normalizeFilters(filters);
  const defaults: ScopeDefaults = {};
  if (normalized.state?.length === 1) defaults.state_id = normalized.state[0];
  if (normalized.priority?.length === 1) defaults.priority = normalized.priority[0];
  if (normalized.cycle?.length === 1) defaults.cycle_id = normalized.cycle[0];
  if (normalized.labels?.length) defaults.label_ids = [...normalized.labels];
  if (normalized.assignees?.length) defaults.assignee_ids = [...normalized.assignees];
  if (normalized.module?.length) defaults.module_ids = [...normalized.module];
  return defaults;
}

/** "Board · grouped by State · 2 filters" for a row without a description. */
export function viewSummary(view: Pick<View, "filters" | "display">): string {
  const parts: string[] = [LAYOUT_LABELS[view.display.layout]];
  if (view.display.group_by) parts.push(`grouped by ${GROUP_LABELS[view.display.group_by]}`);
  const count = Object.keys(normalizeFilters(view.filters)).length;
  parts.push(count === 0 ? "no filters" : count === 1 ? "1 filter" : `${count} filters`);
  return parts.join(" · ");
}
