import type { WorkItem, WorkItemListResult } from "@/lib/tessera/types";

/**
 * Slim list rows: a list, board, table, calendar or gantt row never draws the
 * description, its version, the import ids, the draft flag, the delete stamp or
 * who edited last, yet each one rode in every flight (the description alone is
 * about a tenth of the demo list's payload, more on a large project). The rows
 * keep their type, so these fields are blanked, not removed. The peek and the
 * detail page load the full item through `loadWorkItemDetail`.
 */
export function slimListRows(items: readonly WorkItem[]): WorkItem[] {
  return items.map((item) => ({
    ...item,
    description_md: "",
    description_version: 0,
    external_source: null,
    external_id: null,
    is_draft: false,
    deleted_at: null,
    updated_by: "",
  }));
}

/** The list result with slim rows; groups, relations and the rest stay as they are. */
export function slimListResult(result: WorkItemListResult): WorkItemListResult {
  return { ...result, items: slimListRows(result.items) };
}
