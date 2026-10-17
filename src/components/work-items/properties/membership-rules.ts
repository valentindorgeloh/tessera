/**
 * Cycle and module membership rules of the property controls
 * (docs/contracts/ui.md "Integration (E4)", mismatch 34). Pure and
 * directive-free so Vitest covers them (tests/ui/property-controls.test.ts).
 *
 * The project bundle holds only non-archived cycles and modules, but an item
 * may still sit in an archived one. The engine refuses to move an item out of
 * a completed cycle (`LOCKED`) or an archived one (`ARCHIVED`), and refuses
 * `set_modules` calls that drop an archived module (`ARCHIVED`). So the cycle
 * control turns read-only for those values, and the module control keeps the
 * archived ids out of the editable value and adds them back on every change.
 */
import type { Cycle, CycleStatus, Module } from "@/lib/tessera/types";

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  current: "Current",
  upcoming: "Upcoming",
  completed: "Completed",
  draft: "Draft",
};

export type CycleControlModel = {
  options: { value: string; label: string; description: string }[];
  readOnly: boolean;
  reason: "completed" | "archived" | null;
};

/**
 * Options are the cycles that are neither completed nor archived, plus the
 * current value. A completed value is read-only (`reason: "completed"`); an
 * archived value is read-only (`reason: "archived"`), either present in the
 * bundle with `archived_at` set or missing from it (shown through a synthetic
 * option).
 */
export function cycleControlModel(value: string | null, cycles: readonly Pick<Cycle, "id" | "name" | "status" | "archived_at">[]): CycleControlModel {
  // Open targets only (F3.10): a completed or archived cycle is no target; the item's own cycle stays so the selector shows it.
  const options = cycles
    .filter((cycle) => (cycle.status !== "completed" && cycle.archived_at === null) || cycle.id === value)
    .map((cycle) => ({ value: cycle.id, label: cycle.name, description: CYCLE_STATUS_LABEL[cycle.status] }));
  if (value === null) return { options, readOnly: false, reason: null };
  const current = cycles.find((cycle) => cycle.id === value);
  if (current === undefined || current.archived_at !== null) {
    if (current !== undefined) return { options, readOnly: true, reason: "archived" };
    return { options: [...options, { value, label: "Archived cycle", description: "Archived" }], readOnly: true, reason: "archived" };
  }
  if (current.status === "completed") return { options, readOnly: true, reason: "completed" };
  return { options, readOnly: false, reason: null };
}

/** Module picker options: the modules that are not archived (an archived module is no target, F3.10). */
export function moduleControlOptions(modules: readonly Pick<Module, "id" | "name" | "archived_at">[]): { value: string; label: string }[] {
  return modules.filter((module) => module.archived_at === null).map((module) => ({ value: module.id, label: module.name }));
}

/** The module ids the control may change (`editable`, in the bundle) and the archived ones it must keep (`kept`). */
export function splitModuleValue(value: readonly string[], modules: readonly Pick<Module, "id">[]): { editable: string[]; kept: string[] } {
  const known = new Set(modules.map((module) => module.id));
  const editable: string[] = [];
  const kept: string[] = [];
  for (const id of value) (known.has(id) ? editable : kept).push(id);
  return { editable, kept };
}

/** The new module ids with the kept (archived) ones added back, so `set_modules` never drops them. */
export function mergeModuleChange(next: readonly string[], kept: readonly string[]): string[] {
  const out = [...next];
  for (const id of kept) if (!out.includes(id)) out.push(id);
  return out;
}

/** "1 archived module" / "3 archived modules". */
export function archivedModulesLabel(count: number): string {
  return `${count} archived module${count === 1 ? "" : "s"}`;
}
