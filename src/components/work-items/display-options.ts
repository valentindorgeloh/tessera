/**
 * Choices of the Display menu (docs/contracts/ui.md "Work items screen", P4
 * "DisplayMenu.tsx and LayoutSwitch"). Pure and directive-free, so Vitest
 * covers it (tests/ui/display-options.test.ts) and DisplayMenu, ViewBar and
 * view-state.ts share one set of words.
 */
import { GROUPABLE_FIELDS, ORDER_BY_VALUES } from "@/lib/tessera/core/group";
import { SubGroupBySchema } from "@/lib/tessera/schemas";
import type { Display, DisplayPatch, GroupBy, OrderBy, Project, SubGroupBy } from "@/lib/tessera/types";

/** The words for a grouping field, in the Display menu's Group by and Sub-group by and in a view's summary. */
export const GROUP_LABELS: Record<GroupBy, string> = {
  state: "State",
  state_group: "State group",
  priority: "Priority",
  labels: "Labels",
  cycle: "Cycle",
  module: "Module",
  assignees: "Assignees",
  created_by: "Created by",
  start_date: "Start date",
  target_date: "Target date",
  created_at: "Created",
  project: "Project",
};

/** Order by choices in menu order; `-sort_order` is not offered. */
const ORDER_CHOICES: readonly { value: OrderBy; label: string }[] = [
  { value: "sort_order", label: "Manual" },
  { value: "-created_at", label: "Created (newest first)" },
  { value: "created_at", label: "Created (oldest first)" },
  { value: "-updated_at", label: "Updated (newest first)" },
  { value: "updated_at", label: "Updated (oldest first)" },
  { value: "priority", label: "Priority (urgent first)" },
  { value: "-priority", label: "Priority (none first)" },
  { value: "start_date", label: "Start date (earliest first)" },
  { value: "-start_date", label: "Start date (latest first)" },
  { value: "target_date", label: "Target date (earliest first)" },
  { value: "-target_date", label: "Target date (latest first)" },
  { value: "name", label: "Name (A–Z)" },
  { value: "-name", label: "Name (Z–A)" },
  { value: "sequence_id", label: "Key (oldest first)" },
  { value: "-sequence_id", label: "Key (newest first)" },
  { value: "estimate", label: "Estimate (smallest first)" },
  { value: "-estimate", label: "Estimate (largest first)" },
];

/** Order by choices with "Manual" once; values the schema does not accept are skipped. */
export function orderByChoices(): { value: OrderBy; label: string }[] {
  const accepted: readonly string[] = ORDER_BY_VALUES;
  return ORDER_CHOICES.filter((choice) => accepted.includes(choice.value)).map((choice) => ({ ...choice }));
}

/** The choice that shows for a stored order: a stored `-sort_order` still applies and reads "Manual". */
export function orderBySelectValue(orderBy: OrderBy): OrderBy {
  return orderBy === "-sort_order" ? "sort_order" : orderBy;
}

/** None first, then the groupable fields except Project, the hidden fields (a cycle list cannot group by cycle) and the features turned off. */
export function groupByChoices(
  project: Pick<Project, "cycles_enabled" | "modules_enabled">,
  hidden: readonly GroupBy[],
): { value: GroupBy | null; label: string }[] {
  const fields = GROUPABLE_FIELDS.filter(
    (field) =>
      field !== "project" &&
      !hidden.includes(field) &&
      (field !== "cycle" || project.cycles_enabled) &&
      (field !== "module" || project.modules_enabled),
  );
  return [{ value: null, label: "None" }, ...fields.map((field) => ({ value: field, label: GROUP_LABELS[field] }))];
}

/** None first, then the sub-group fields without the group field, the hidden fields and the features turned off. */
export function subGroupChoices(
  display: Display,
  project: Pick<Project, "cycles_enabled" | "modules_enabled">,
  hidden: readonly GroupBy[],
): { value: SubGroupBy | null; label: string }[] {
  const fields = SubGroupBySchema.options.filter(
    (field) =>
      field !== display.group_by &&
      !hidden.includes(field) &&
      (field !== "cycle" || project.cycles_enabled) &&
      (field !== "module" || project.modules_enabled),
  );
  return [{ value: null, label: "None" }, ...fields.map((field) => ({ value: field, label: GROUP_LABELS[field] }))];
}

/** Patch for a Group by change: the sub-group is cleared when it would repeat the group or the grouping goes away. */
export function groupByPatch(display: Display, next: GroupBy | null): Pick<DisplayPatch, "group_by" | "sub_group_by"> {
  if (next === null || next === display.sub_group_by) return { group_by: next, sub_group_by: null };
  return { group_by: next };
}
