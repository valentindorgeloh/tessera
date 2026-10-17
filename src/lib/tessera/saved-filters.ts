/**
 * Saved-filter cleanup (decision 32). Deleting a state, label, cycle or module
 * strips its id from every saved view of the project and of the workspace
 * (locked ones too) and from every remembered `view_settings` row, so no
 * filter keeps an id that can never resolve again. Runs inside the caller's
 * transaction. Not exported from the engine barrel: the delete functions of
 * states, labels, cycles and modules are its only callers.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { diffFields } from "./activity";
import type { TesseraContext } from "./core/context";
import { assertInTransaction } from "./core/tx";
import { view, view_settings } from "./db/schema";
import { FiltersSchema } from "./schemas";
import type { Filters } from "./types";
import { viewSettingsEntityId } from "./view-settings";

export type SavedFilterKey = "state" | "labels" | "cycle" | "module";

/** Filters without `ids` under `key` (the key is removed when its list empties); null when nothing in `key` matches. */
function stripIds(filters: Filters, key: SavedFilterKey, ids: ReadonlySet<string>): Filters | null {
  const list = filters[key];
  if (!list || !list.some((id) => ids.has(id))) return null;
  const remaining = list.filter((id) => !ids.has(id));
  const next: Filters = { ...filters };
  if (remaining.length > 0) {
    next[key] = remaining;
  } else {
    delete next[key];
  }
  return next;
}

export function stripIdsFromSavedFilters(ctx: TesseraContext, input: { key: SavedFilterKey; ids: ReadonlySet<string>; project_id: string }): void {
  assertInTransaction(ctx, "stripIdsFromSavedFilters");
  const { key, ids, project_id } = input;
  const now = ctx.now();
  // Workspace views (project_id null) may filter by any project's ids.
  const views = ctx.db
    .select()
    .from(view)
    .where(and(or(eq(view.project_id, project_id), isNull(view.project_id)), isNull(view.deleted_at)))
    .all();
  for (const row of views) {
    const parsed = FiltersSchema.safeParse(row.filters);
    if (!parsed.success) continue;
    const next = stripIds(parsed.data, key, ids);
    if (next === null) continue;
    ctx.db.update(view).set({ filters: next, updated_at: now, updated_by: ctx.actor.id }).where(eq(view.id, row.id)).run();
    diffFields(ctx, { project_id, entity_type: "view", entity_id: row.id }, { filters: parsed.data }, { filters: next }, ["filters"]);
  }
  // One small row per scope; ids are globally unique, so every row is checked.
  for (const row of ctx.db.select().from(view_settings).all()) {
    const parsed = FiltersSchema.safeParse(row.filters);
    if (!parsed.success) continue;
    const next = stripIds(parsed.data, key, ids);
    if (next === null) continue;
    ctx.db
      .update(view_settings)
      .set({ filters: next, updated_at: now })
      .where(and(eq(view_settings.scope_type, row.scope_type), eq(view_settings.scope_id, row.scope_id)))
      .run();
    diffFields(
      ctx,
      { project_id, entity_type: "view_settings", entity_id: viewSettingsEntityId(row.scope_type, row.scope_id) },
      { filters: parsed.data },
      { filters: next },
      ["filters"],
    );
  }
}
