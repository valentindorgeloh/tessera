/**
 * Filter keys the filter bar edits and how a removed key is written back
 * (docs/contracts/ui.md "Work items screen"). The server layers
 * defaults <- saved view settings <- URL, and a later layer can only replace a
 * key it carries: dropping `state` from the URL would let a saved `state`
 * filter come straight back, so a removed token or "Clear" writes the explicit
 * empty value (`[]`, `""`) that the engine treats as "no filter". Pure and
 * client-safe.
 */
import type { Filters } from "@/lib/tessera/types";

/** List-valued keys the bar shows as "is any of" tokens. */
export const LIST_FIELDS = ["state", "state_group", "priority", "labels", "assignees", "cycle", "module", "project"] as const;
export type ListField = (typeof LIST_FIELDS)[number];

/** Date keys the bar shows as relative-window or absolute tokens. */
export const DATE_FIELDS = ["target_date", "start_date"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export function isListField(key: string): key is ListField {
  return (LIST_FIELDS as readonly string[]).includes(key);
}

export function isDateField(key: string): key is DateField {
  return (DATE_FIELDS as readonly string[]).includes(key);
}

/**
 * `next` plus an explicit empty value for every list or search key that
 * `current` (the effective filters) still carries and `next` no longer names.
 * Date filters have no empty form in FiltersSchema, so a saved date filter
 * cannot be cleared from the bar; it keeps whatever `next` says.
 */
export function withExplicitClears(current: Filters, next: Filters): Filters {
  const out: Filters = { ...next };
  for (const field of LIST_FIELDS) {
    const value = current[field];
    if (value && value.length > 0 && !(field in next)) Object.assign(out, { [field]: [] });
  }
  if (current.search && !("search" in next)) out.search = "";
  return out;
}
