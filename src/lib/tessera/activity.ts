/**
 * Activity log (decision 24): one append-only row per change, `seq` is the
 * global change cursor. `logActivity` and `diffFields` must run inside the
 * mutation's transaction so the log never disagrees with the data.
 */
import type { Database } from "better-sqlite3";
import { z } from "zod";
import type { TesseraContext } from "./core/context";
import { validateInput } from "./core/errors";
import { newId } from "./core/ids";
import { assertInTransaction } from "./core/tx";
import { activity } from "./db/schema";
import { notifyFromActivity } from "./notifications";
import type { ActivityRow } from "./types";

/** Verbs used by the engine; the column is free text so adapters can read new verbs without a migration. */
export const ACTIVITY_VERBS = [
  "created",
  "updated",
  "deleted",
  "archived",
  "restored",
  "commented",
  "added",
  "removed",
  "moved",
  "copied",
  "locked",
  "unlocked",
  "reacted",
  "unreacted",
  "registered",
] as const;

export type ActivityVerb = (typeof ACTIVITY_VERBS)[number] | (string & {});

export const ActivityEntrySchema = z.object({
  project_id: z.string().nullable().optional().describe("Project the change belongs to, when any."),
  entity_type: z.string().min(1).describe("Entity kind, e.g. work_item, project, cycle."),
  entity_id: z.string().min(1).describe("Id of the changed entity."),
  work_item_id: z.string().nullable().optional().describe("Work item the change rolls up to, when any."),
  verb: z.string().min(1).describe("What happened: created, updated, deleted, archived, restored, commented, ..."),
  field: z.string().nullable().optional().describe("Changed field for updated rows."),
  old_value: z.string().nullable().optional().describe("Previous raw value."),
  new_value: z.string().nullable().optional().describe("New raw value."),
  old_identifier: z.string().nullable().optional().describe("Human-readable previous value (a name or key)."),
  new_identifier: z.string().nullable().optional().describe("Human-readable new value."),
  comment: z.string().nullable().optional().describe("Free text, e.g. an automation's explanation."),
});

export type ActivityEntry = z.input<typeof ActivityEntrySchema>;

export type ActivityTarget = {
  entity_type: string;
  entity_id: string;
  project_id?: string | null;
  work_item_id?: string | null;
};

/** Callback turning a raw field value into a human-readable identifier (state id -> state name). */
export type IdentifierResolver = (field: string, value: unknown) => string | null | undefined;

/** Stores strings as-is, null as NULL and everything else as JSON so values round-trip. */
export function serializeActivityValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Inserts one activity row; must be called inside withTx. */
export function logActivity(ctx: TesseraContext, entry: ActivityEntry): ActivityRow {
  assertInTransaction(ctx, "logActivity");
  const input = validateInput(ActivityEntrySchema, entry);
  const comment = input.comment ?? ctx.activityNote ?? null;
  const row = ctx.db
    .insert(activity)
    .values({
      uid: newId(),
      project_id: input.project_id ?? null,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      work_item_id: input.work_item_id ?? null,
      verb: input.verb,
      field: input.field ?? null,
      old_value: input.old_value ?? null,
      new_value: input.new_value ?? null,
      old_identifier: input.old_identifier ?? null,
      new_identifier: input.new_identifier ?? null,
      comment,
      actor_id: ctx.actor.id,
      created_at: ctx.now(),
    })
    .returning()
    .get();
  notifyFromActivity(ctx, { ...input, comment });
  return row;
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  return serializeActivityValue(a) !== serializeActivityValue(b);
}

/**
 * Writes one `updated` row per field whose value changed between `before` and
 * `after`. `resolveIdentifier` supplies old_identifier / new_identifier for
 * fields that hold ids. Returns the rows written (empty when nothing changed).
 */
export function diffFields<T extends object>(
  ctx: TesseraContext,
  target: ActivityTarget,
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
  resolveIdentifier?: IdentifierResolver,
): ActivityRow[] {
  assertInTransaction(ctx, "diffFields");
  const rows: ActivityRow[] = [];
  for (const field of fields) {
    const oldValue = before[field];
    const newValue = after[field];
    if (!valuesDiffer(oldValue, newValue)) continue;
    rows.push(
      logActivity(ctx, {
        ...target,
        verb: "updated",
        field,
        old_value: serializeActivityValue(oldValue),
        new_value: serializeActivityValue(newValue),
        old_identifier: resolveIdentifier?.(field, oldValue) ?? null,
        new_identifier: resolveIdentifier?.(field, newValue) ?? null,
      }),
    );
  }
  return rows;
}

/** Highest activity.seq, or 0 on an empty log. Accepts a context or the raw handle. */
export function latestSeq(source: TesseraContext | Database): number {
  const sqlite = "sqlite" in source ? source.sqlite : source;
  const row = sqlite.prepare<[], { seq: number | null }>("SELECT max(seq) AS seq FROM activity").get();
  return row?.seq ?? 0;
}
