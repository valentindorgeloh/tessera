/**
 * Active estimate resolution shared by cycle and module progress.
 * Points mode counts only an active system whose type is `points`.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { TesseraContext } from "./core/context";
import { estimate } from "./db/schema";
import type { ProjectRow } from "./types";

/** The project's active points system, or null for categories, time, a missing system, or estimates turned off. */
export function activeEstimateId(ctx: TesseraContext, projectRow: Pick<ProjectRow, "estimates_enabled" | "estimate_id">): string | null {
  if (!projectRow.estimates_enabled || projectRow.estimate_id === null) return null;
  const row = ctx.db
    .select({ type: estimate.type })
    .from(estimate)
    .where(and(eq(estimate.id, projectRow.estimate_id), isNull(estimate.deleted_at), isNull(estimate.archived_at)))
    .get();
  if (!row || row.type !== "points") return null;
  return projectRow.estimate_id;
}

/** `estimate_point.value` as a number when it is numeric and >= 0 (fractions allowed); null otherwise. */
export function parsePointValue(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
