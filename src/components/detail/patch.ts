/**
 * Pure helpers for detail writes (tested in tests/ui/detail-text.test.ts):
 * the P2a controls re-fire unchanged values (a Selector closed with Enter, a
 * typed date that DateInput reports twice), so a patch is compared with the
 * latest known values before any call, and the optimistic view merges the
 * fields that did change.
 */
import type { UpdateWorkItemInputType, WorkItem, WorkItemDetail } from "@/lib/tessera/types";

/** Field patch of update_work_item (the wrapper adds work_item_id). */
export type DetailPatch = UpdateWorkItemInputType;

/** Fields the detail writes and shows optimistically: update_work_item's columns plus the id lists of the set_* tools. */
export type DetailFields = Pick<
  WorkItemDetail,
  "name" | "state_id" | "priority" | "parent_id" | "cycle_id" | "start_date" | "target_date" | "label_ids" | "assignee_ids" | "module_ids" | "subscriber_ids"
>;

export type OptimisticPatch = Partial<DetailFields>;

/** Same ids regardless of order. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return sameIds(a as string[], b as string[]);
  return a === b;
}

/**
 * The entries of `patch` whose value differs from `current` (id lists compared
 * as sets, `undefined` entries ignored); null when nothing would change.
 */
export function changedFields<T extends object>(current: T, patch: Partial<T>): Partial<T> | null {
  const out: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const next = patch[key];
    if (next === undefined || sameValue(next, current[key])) continue;
    out[key] = next;
    changed = true;
  }
  return changed ? out : null;
}

/** True when every key of `patch` already holds the item's value. */
export function isNoopPatch(item: WorkItem, patch: DetailPatch): boolean {
  return changedFields<DetailPatch>(item, patch) === null;
}

/** Reducer of the optimistic view: the item with the patch's defined fields applied. */
export function applyPatch<T extends object>(current: T, patch: Partial<T>): T {
  const next = { ...current };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value as T[keyof T];
  }
  return next;
}

/** `ids` with `id` added or removed. */
export function toggleId(ids: readonly string[], id: string, include: boolean): string[] {
  const without = ids.filter((entry) => entry !== id);
  return include ? [...without, id] : without;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A stored `YYYY-MM-DD` value, or undefined for null and malformed values (DateInput takes undefined for "no date"). */
export function storedIsoDate(value: string | null | undefined): string | undefined {
  return value && ISO_DATE.test(value) ? value : undefined;
}
