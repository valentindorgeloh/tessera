/**
 * Module labels, status colours, date ranges and menu rules (docs/contracts/ui.md
 * "Modules (E2)"). Pure and directive-free: Server Components, client
 * components and Vitest (`tests/ui/module-format.test.ts`) import it alike, and
 * E3's archived modules list reuses it. Components cannot import the engine's
 * `modules.ts`, so `ARCHIVABLE_STATUSES` repeats `ARCHIVABLE_MODULE_STATUSES`
 * and the test keeps the two equal.
 */
import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { ModuleStatusSchema } from "@/lib/tessera/schemas";
import type { Module, ModuleStatus, ProgressCounts } from "@/lib/tessera/types";

/** Status labels in plain English, keyed by the engine's status values. */
export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Statuses in the engine's order, for selectors. */
export const MODULE_STATUSES: readonly ModuleStatus[] = ModuleStatusSchema.options;

/** A module may be archived only while its status is one of these (engine: `ARCHIVABLE_MODULE_STATUSES`). */
export const ARCHIVABLE_STATUSES: readonly ModuleStatus[] = ["completed", "cancelled"];

/** Why Archive is disabled on a module whose status is not archivable. */
export const ARCHIVE_BLOCKED_REASON = "Set the status to Completed or Cancelled first";

export function isModuleStatus(value: string): value is ModuleStatus {
  return (MODULE_STATUSES as readonly string[]).includes(value);
}

/** Backlog and planned neutral, in progress accent, paused warning, completed success, cancelled error. */
export function moduleStatusVariant(status: ModuleStatus): StatusDotVariant {
  switch (status) {
    case "in_progress":
      return "accent";
    case "paused":
      return "warning";
    case "completed":
      return "success";
    case "cancelled":
      return "error";
    case "backlog":
    case "planned":
      return "neutral";
  }
}

export function canArchiveModule(status: ModuleStatus): boolean {
  return ARCHIVABLE_STATUSES.includes(status);
}

/** "Mar 1 – Mar 14", "From Mar 1", "Until Mar 14" or "No dates". */
export function formatModuleRange(start: string | null, target: string | null): string {
  if (start && target) return `${formatShortDate(start)} – ${formatShortDate(target)}`;
  if (start) return `From ${formatShortDate(start)}`;
  if (target) return `Until ${formatShortDate(target)}`;
  return "No dates";
}

/** Completed items against the work that counts (total minus cancelled), as the progress bars use them. */
export function moduleProgressValues(progress: Pick<ProgressCounts, "total" | "completed" | "cancelled">): { value: number; max: number } {
  return { value: progress.completed, max: Math.max(progress.total - progress.cancelled, 0) };
}

/** "3/8" next to a row's progress bar. */
export function moduleProgressText(progress: Pick<ProgressCounts, "total" | "completed" | "cancelled">): string {
  const { value, max } = moduleProgressValues(progress);
  return `${value}/${max}`;
}

export type ModuleActionId = "edit" | "archive" | "restore" | "delete";

/** One menu entry; the menu adds icons and handlers by `id`. */
export type ModuleAction = {
  id: ModuleActionId;
  label: string;
  isDisabled?: boolean;
  description?: string;
  variant?: "default" | "destructive";
};

/**
 * The module menu: Edit…, Archive (enabled only for completed or cancelled
 * modules), Delete… on an active module; Restore and Delete… on an archived one.
 */
export function moduleActions(module: Pick<Module, "status" | "archived_at">): ModuleAction[] {
  const remove: ModuleAction = { id: "delete", label: "Delete…", variant: "destructive" };
  if (module.archived_at !== null) return [{ id: "restore", label: "Restore" }, remove];
  const archivable = canArchiveModule(module.status);
  return [
    { id: "edit", label: "Edit…" },
    archivable ? { id: "archive", label: "Archive" } : { id: "archive", label: "Archive", isDisabled: true, description: ARCHIVE_BLOCKED_REASON },
    remove,
  ];
}

/** "Delete Launch? Its work items stay and leave the module." */
export function deleteModuleTitle(name: string): string {
  return `Delete ${name}?`;
}

export const DELETE_MODULE_DESCRIPTION = "Its work items stay and leave the module.";

const DATE_FIELDS = new Set(["start_date", "target_date"]);

function issueField(issue: unknown): string | null {
  if (typeof issue !== "object" || issue === null || !("path" in issue)) return null;
  const path = (issue as { path: unknown }).path;
  return Array.isArray(path) && typeof path[0] === "string" ? path[0] : null;
}

/** "target_date must be on or after start_date" → "Target date must be on or after start date". */
function plainFieldNames(message: string): string {
  const text = message.replace(/\b(start|target)_date\b/g, "$1 date");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The engine's message for a `VALIDATION` failure on a module's dates (issues
 * whose `path[0]` is `start_date` or `target_date`), with the field names in
 * plain words; null when the failure is about something else.
 */
export function moduleDateError(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  for (const issue of details) {
    const field = issueField(issue);
    if (field === null || !DATE_FIELDS.has(field)) continue;
    const message = (issue as { message?: unknown }).message;
    return typeof message === "string" && message !== "" ? plainFieldNames(message) : "Target date must be on or after start date";
  }
  return null;
}

/** Fields of an edit that changed, so `update_module` only receives those. */
export type ModuleFormValues = {
  name: string;
  description_md: string;
  status: ModuleStatus;
  lead_actor_id: string | null;
  start_date: string | null;
  target_date: string | null;
};

export function changedModuleFields(
  before: Pick<Module, "name" | "description_md" | "status" | "lead_actor_id" | "start_date" | "target_date">,
  after: ModuleFormValues,
): Partial<ModuleFormValues> {
  const patch: Partial<ModuleFormValues> = {};
  if (after.name !== before.name) patch.name = after.name;
  if (after.description_md !== before.description_md) patch.description_md = after.description_md;
  if (after.status !== before.status) patch.status = after.status;
  if (after.lead_actor_id !== before.lead_actor_id) patch.lead_actor_id = after.lead_actor_id;
  if (after.start_date !== before.start_date) patch.start_date = after.start_date;
  if (after.target_date !== before.target_date) patch.target_date = after.target_date;
  return patch;
}

/** Same member set regardless of order. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Links must be absolute http(s) URLs (engine `links.ts`). */
export function isHttpUrl(value: string): boolean {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
