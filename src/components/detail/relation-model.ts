/**
 * Pure model of the Relations section (decision 55): the rows as the detail
 * loads them, their grouping by display type from this item's side, the
 * optimistic add and remove, and the parser of the search answer the "Add
 * relation" dialog lists. No React, so Vitest covers it directly
 * (tests/ui/relations-list.test.ts). Client-safe: type-only engine imports.
 */
import { RELATION_DISPLAY_TYPES, type RelationDisplayType } from "@/lib/tessera/schemas";
import type { StateGroup } from "@/lib/tessera/types";

export type { RelationDisplayType };

/** The item on the other side of a relation, with what a row shows. */
export type RelatedItem = {
  id: string;
  key: string;
  name: string;
  project_id: string;
  /** True when the related item is archived: it stays listed, marked. */
  archived: boolean;
  /** Null while an optimistic row waits for the refresh to bring the state. */
  state: { name: string; state_group: StateGroup } | null;
};

/** One live relation as seen from the open item: `relation_type` is that item's side. */
export type RelationRowView = {
  id: string;
  relation_type: RelationDisplayType;
  item: RelatedItem;
};

/** Row wording per display type, from the open item's side ("this item is <label> the other"). */
export const RELATION_LABELS: Record<RelationDisplayType, string> = {
  blocked_by: "Blocked by",
  blocking: "Blocking",
  relates_to: "Relates to",
  duplicate: "Duplicate of",
  start_before: "Starts before",
  start_after: "Starts after",
  finish_before: "Finishes before",
  finish_after: "Finishes after",
  implemented_by: "Implemented by",
  implements: "Implements",
};

/** The choices of the type picker, in the order of the engine's display types. */
export const RELATION_CHOICES: readonly { value: RelationDisplayType; label: string }[] = RELATION_DISPLAY_TYPES.map((value) => ({ value, label: RELATION_LABELS[value] }));

export type RelationGroup = { type: RelationDisplayType; label: string; rows: RelationRowView[] };

/** Rows grouped by display type in the picker's order; a type with no row is left out. */
export function groupRelations(rows: readonly RelationRowView[]): RelationGroup[] {
  const groups: RelationGroup[] = [];
  for (const type of RELATION_DISPLAY_TYPES) {
    const inGroup = rows.filter((row) => row.relation_type === type);
    if (inGroup.length > 0) groups.push({ type, label: RELATION_LABELS[type], rows: inGroup });
  }
  return groups;
}

/** What the optimistic state replays: a pair gets one type, so adding replaces the item's earlier row. */
export type RelationEdit = { kind: "add"; row: RelationRowView } | { kind: "remove"; id: string };

export function applyRelationEdit(rows: readonly RelationRowView[], edit: RelationEdit): RelationRowView[] {
  if (edit.kind === "remove") return rows.filter((row) => row.id !== edit.id);
  return [...rows.filter((row) => row.item.id !== edit.row.item.id), edit.row];
}

/** A hit of the item search as the dialog lists it. */
export type RelationCandidate = { id: string; key: string; title: string; project_id: string | null; subtitle: string | null };

/** Work item hits of a `GET /api/search` answer; a malformed row or answer yields nothing. */
export function toRelationCandidates(payload: unknown): RelationCandidate[] {
  if (typeof payload !== "object" || payload === null || !("hits" in payload) || !Array.isArray(payload.hits)) return [];
  const out: RelationCandidate[] = [];
  for (const hit of payload.hits as unknown[]) {
    if (typeof hit !== "object" || hit === null) continue;
    const { id, key, title, project_id, subtitle } = hit as Record<string, unknown>;
    if (typeof id !== "string" || typeof title !== "string") continue;
    out.push({
      id,
      key: typeof key === "string" ? key : "",
      title,
      project_id: typeof project_id === "string" ? project_id : null,
      subtitle: typeof subtitle === "string" ? subtitle : null,
    });
  }
  return out;
}

/** The row shown at once when a hit is picked; the refresh replaces it with the stored one. */
export function optimisticRelationRow(type: RelationDisplayType, hit: RelationCandidate, fallbackProjectId: string): RelationRowView {
  return {
    id: `pending-${hit.id}`,
    relation_type: type,
    item: { id: hit.id, key: hit.key, name: hit.title, project_id: hit.project_id ?? fallbackProjectId, archived: false, state: null },
  };
}
