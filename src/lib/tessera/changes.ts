/**
 * Change feed and activity reads (docs/contracts/service-api.md "activity.ts /
 * changes.ts", plan decision 24). `activity.seq` is the global cursor:
 * `listChanges(sinceSeq)` returns the rows after it, optionally without the
 * given actors (the UI skips `user` so it only refreshes on external writes),
 * and a cursor that never moves backwards. `listActivity` is the per-item or
 * per-project feed with a read-time collapse of consecutive description edits
 * by the same actor within five minutes into one entry. Both are reads: no
 * transaction, nothing written.
 */
import { and, asc, desc, eq, gt, notInArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { latestSeq } from "./activity";
import type { TesseraContext } from "./core/context";
import { validateInput } from "./core/errors";
import { activity, actor } from "./db/schema";
import { getProjectRow } from "./projects";
import { IdSchema } from "./schemas";
import type { ActivityRow } from "./types";
import { getWorkItemRow } from "./work-items";

export { latestSeq };

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** What a poller needs to decide whether to refresh; values are not included. */
export type Change = Pick<ActivityRow, "seq" | "entity_type" | "entity_id" | "work_item_id" | "project_id" | "verb" | "field" | "actor_id" | "created_at">;

export type ChangesResult = {
  /** Rows with `seq > since_seq`, oldest first. */
  changes: Change[];
  /** Pass this as the next `since_seq`: the last returned seq when the page was cut by `limit`, else the latest seq in the log. */
  cursor: number;
};

/** Rows per call when `limit` is omitted; a cut page moves the cursor only as far as it returned. */
export const DEFAULT_CHANGES_LIMIT = 1000;

export const ListChangesInput = z
  .object({
    since_seq: z.number().int().min(0).describe("Cursor from the previous call; 0 for everything."),
    exclude_actors: z.array(z.string().min(1)).max(100).optional().describe("Actor ids whose changes are left out (the UI passes the user)."),
    limit: z.number().int().min(1).max(5000).optional().describe("Most rows to return (default 1000)."),
  })
  .strict();

export type ListChangesInputType = z.input<typeof ListChangesInput>;

export type ListChangesOptions = { excludeActors?: string[]; limit?: number };

const CHANGE_COLUMNS = {
  seq: activity.seq,
  entity_type: activity.entity_type,
  entity_id: activity.entity_id,
  work_item_id: activity.work_item_id,
  project_id: activity.project_id,
  verb: activity.verb,
  field: activity.field,
  actor_id: activity.actor_id,
  created_at: activity.created_at,
};

export function listChanges(ctx: TesseraContext, sinceSeq: number, options: ListChangesOptions = {}): ChangesResult {
  const data = validateInput(ListChangesInput, { since_seq: sinceSeq, exclude_actors: options.excludeActors, limit: options.limit });
  const limit = data.limit ?? DEFAULT_CHANGES_LIMIT;
  const excluded = data.exclude_actors ?? [];
  const where = and(gt(activity.seq, data.since_seq), excluded.length > 0 ? notInArray(activity.actor_id, excluded) : undefined);
  // One extra row tells whether the page was cut without a second count query.
  const rows = ctx.db
    .select(CHANGE_COLUMNS)
    .from(activity)
    .where(where)
    .orderBy(asc(activity.seq))
    .limit(limit + 1)
    .all();
  const cut = rows.length > limit;
  const changes = cut ? rows.slice(0, limit) : rows;
  const cursor = cut ? changes[changes.length - 1].seq : Math.max(data.since_seq, latestSeq(ctx));
  return { changes, cursor };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type ActivityLogEntry = ActivityRow & {
  /** Display name of the actor at read time (the id when the actor row is gone). */
  actor_name: string;
  /** Raw rows merged into this entry; 1 when nothing was collapsed. */
  merged_count: number;
  /** seq of the newest merged row; equals `seq` when nothing was collapsed. */
  last_seq: number;
};

/** Description edits by the same actor closer together than this collapse into one entry. */
export const DESCRIPTION_COLLAPSE_WINDOW_MS = 5 * 60_000;

export const DEFAULT_ACTIVITY_LIMIT = 500;

export const ListActivityInput = z
  .object({
    work_item_id: IdSchema.optional().describe("Feed of one work item (its own rows plus memberships and relations logged on it)."),
    project_id: IdSchema.optional().describe("Feed of a whole project."),
    since_seq: z.number().int().min(0).optional().describe("Only rows after this seq."),
    limit: z.number().int().min(1).max(5000).optional().describe("Newest raw rows to read before collapsing (default 500)."),
  })
  .strict()
  .refine((value) => (value.work_item_id === undefined) !== (value.project_id === undefined), {
    message: "exactly one of work_item_id or project_id is required",
  });

export type ListActivityInputType = z.input<typeof ListActivityInput>;

type RawRow = { row: ActivityRow; actor_name: string | null };

function isDescriptionEdit(row: ActivityRow): boolean {
  return row.entity_type === "work_item" && row.verb === "updated" && row.field === "description_md";
}

function millis(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/** True when `row` continues the description edit `previous` collapsed so far: same item, same actor, close enough to the last merged row. */
function continuesEdit(previous: ActivityLogEntry, lastMergedAt: number, row: ActivityRow): boolean {
  return (
    isDescriptionEdit(previous) &&
    isDescriptionEdit(row) &&
    previous.entity_id === row.entity_id &&
    previous.actor_id === row.actor_id &&
    millis(row.created_at) - lastMergedAt <= DESCRIPTION_COLLAPSE_WINDOW_MS
  );
}

/**
 * Rows oldest first; a description edit merges into the directly preceding
 * entry when that entry is a description edit of the same item by the same
 * actor and the gap to the last merged row is within the window. The merged
 * entry keeps the first row's seq, created_at and old_value and takes the
 * last row's new_value.
 */
export function collapseDescriptionEdits(rows: RawRow[]): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];
  let lastMergedAt = 0;
  for (const { row, actor_name } of rows) {
    const previous = entries[entries.length - 1];
    if (previous !== undefined && continuesEdit(previous, lastMergedAt, row)) {
      previous.new_value = row.new_value;
      previous.new_identifier = row.new_identifier;
      previous.merged_count += 1;
      previous.last_seq = row.seq;
    } else {
      entries.push({ ...row, actor_name: actor_name ?? row.actor_id, merged_count: 1, last_seq: row.seq });
    }
    lastMergedAt = millis(row.created_at);
  }
  return entries;
}

/** The newest `limit` raw rows of the feed, returned oldest first with description edits collapsed. */
export function listActivity(ctx: TesseraContext, input: ListActivityInputType): ActivityLogEntry[] {
  const data = validateInput(ListActivityInput, input);
  const conditions: (SQL | undefined)[] = [];
  if (data.work_item_id !== undefined) {
    getWorkItemRow(ctx, data.work_item_id);
    conditions.push(eq(activity.work_item_id, data.work_item_id));
  }
  if (data.project_id !== undefined) {
    getProjectRow(ctx, data.project_id);
    conditions.push(eq(activity.project_id, data.project_id));
  }
  if (data.since_seq !== undefined) conditions.push(gt(activity.seq, data.since_seq));
  const rows = ctx.db
    .select({ row: activity, actor_name: actor.name })
    .from(activity)
    .leftJoin(actor, eq(activity.actor_id, actor.id))
    .where(and(...conditions))
    .orderBy(desc(activity.seq))
    .limit(data.limit ?? DEFAULT_ACTIVITY_LIMIT)
    .all();
  return collapseDescriptionEdits(rows.reverse());
}
