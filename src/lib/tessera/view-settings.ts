/**
 * Remembered display settings per scope (docs/contracts/service-api.md,
 * schema.md "view_settings", plan decision 23). One row per
 * (scope_type, scope_id); the workspace scope uses scope_id "workspace".
 * Reads fall back to empty filters and DEFAULT_DISPLAY when no row exists;
 * saves merge the given keys over the stored ones so a caller can change one
 * setting without resending the rest. URL parameters override these at read
 * time in the UI; the engine only stores them.
 *
 * `DisplayPatchSchema` and `mergeDisplay` are shared with views.ts: a display
 * patch carries no defaults, so an omitted key never resets a stored value.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { validateInput } from "./core/errors";
import { withTx } from "./core/tx";
import { cycle, moduleTable, project, view_settings } from "./db/schema";
import {
  CalendarLayoutSchema,
  DisplayPropertiesSchema,
  DisplaySchema,
  FiltersSchema,
  GanttZoomSchema,
  GroupBySchema,
  LayoutSchema,
  OrderBySchema,
  SubGroupBySchema,
  ViewSettingsScopeSchema,
  WorkItemTypeFilterSchema,
} from "./schemas";
import type { Display, Filters, ViewSettingsScope } from "./types";

export const WORKSPACE_SCOPE_ID = "workspace";

export type ViewSettings = { filters: Filters; display: Display };

// ---------------------------------------------------------------------------
// Display patches: every key optional and without defaults
// ---------------------------------------------------------------------------

export type DisplayPropertyKey = keyof typeof DisplayPropertiesSchema.shape;

// Object.keys is typed string[]; the shape's keys are the literal property names.
export const DISPLAY_PROPERTY_KEYS = Object.keys(DisplayPropertiesSchema.shape) as DisplayPropertyKey[];

/** Subset of the display properties to switch on or off. */
export const DisplayPropertiesPatchSchema = z
  .partialRecord(z.enum(DISPLAY_PROPERTY_KEYS), z.boolean())
  .describe("Properties to show (true) or hide (false); omitted ones keep their stored value.");

export const CalendarDisplayPatchSchema = z.object({
  layout: CalendarLayoutSchema.optional().describe("Month or week grid."),
  show_weekends: z.boolean().optional().describe("Show Saturday and Sunday columns."),
});

export const GanttDisplayPatchSchema = z.object({
  zoom: GanttZoomSchema.optional().describe("Day width: week, month or quarter."),
  show_relations: z.boolean().optional().describe("Draw dependency connectors between bars."),
});

/** Partial Display: only the given keys change; nested calendar, gantt and properties merge one level deep. */
export const DisplayPatchSchema = z.object({
  layout: LayoutSchema.optional().describe("list, board, table, calendar or gantt."),
  group_by: GroupBySchema.nullable().optional().describe("Field to group by, or null for a flat list."),
  sub_group_by: SubGroupBySchema.nullable().optional().describe("Second grouping axis on the board, or null."),
  order_by: OrderBySchema.optional().describe("Sort field; prefix - for descending."),
  type: WorkItemTypeFilterSchema.optional().describe("null for all, active or backlog."),
  show_empty_groups: z.boolean().optional().describe("Keep groups with no items visible."),
  sub_items: z.boolean().optional().describe("Show sub-items in the list."),
  calendar: CalendarDisplayPatchSchema.optional().describe("Calendar layout options."),
  gantt: GanttDisplayPatchSchema.optional().describe("Gantt layout options."),
  properties: DisplayPropertiesPatchSchema.optional().describe("Which properties each item shows."),
});

export type DisplayPatch = z.output<typeof DisplayPatchSchema>;
export type DisplayPatchInput = z.input<typeof DisplayPatchSchema>;

/** Copy of `patch` without the keys whose value is undefined, so a spread never erases a stored value. */
function definedEntries<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  // Object.keys is typed string[]; every key of `patch` is a key of T.
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * `patch` over `base`; calendar, gantt and properties merge one level deep. The result
 * is a complete Display whose `sub_group_by` is null when there is no
 * `group_by` or it equals `group_by` (a swimlane axis needs a different column axis).
 */
export function mergeDisplay(base: Display, patch: DisplayPatch): Display {
  const { calendar, gantt, properties, ...top } = patch;
  const merged = DisplaySchema.parse({
    ...base,
    ...definedEntries(top),
    calendar: { ...base.calendar, ...definedEntries(calendar ?? {}) },
    gantt: { ...base.gantt, ...definedEntries(gantt ?? {}) },
    properties: { ...base.properties, ...definedEntries(properties ?? {}) },
  });
  if (merged.sub_group_by !== null && (merged.group_by === null || merged.group_by === merged.sub_group_by)) {
    return { ...merged, sub_group_by: null };
  }
  return merged;
}

/** `patch` keys over `base`; an empty list under a key clears that filter. */
export function mergeFilters(base: Filters, patch: Filters): Filters {
  return FiltersSchema.parse({ ...base, ...definedEntries(patch) });
}

export function defaultViewSettings(): ViewSettings {
  return { filters: {}, display: DisplaySchema.parse({}) };
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export const ViewSettingsScopeInput = z
  .object({
    scope_type: ViewSettingsScopeSchema.describe("project, cycle, module, workspace, profile, archived or draft."),
    scope_id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Id of the scoped entity (project, cycle, module or actor); "workspace" or "static:<key>" for the workspace scope.'),
  })
  .strict()
  .refine((value) => value.scope_type !== "workspace" || isWorkspaceScopeId(value.scope_id), {
    message: `the workspace scope uses scope_id "${WORKSPACE_SCOPE_ID}" or static:all, static:assigned, static:created, static:subscribed`,
    path: ["scope_id"],
  });

const STATIC_WORKSPACE_SCOPE_IDS = new Set(["static:all", "static:assigned", "static:created", "static:subscribed"]);

function isWorkspaceScopeId(scopeId: string): boolean {
  return scopeId === WORKSPACE_SCOPE_ID || STATIC_WORKSPACE_SCOPE_IDS.has(scopeId);
}

export type ViewSettingsScopeInputType = z.input<typeof ViewSettingsScopeInput>;

type Scope = z.output<typeof ViewSettingsScopeInput>;

/** `activity.entity_id` of a settings row, `<scope_type>:<scope_id>`; shared with modules that rewrite stored filters (labels.ts). */
export function viewSettingsEntityId(scopeType: ViewSettingsScope, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

function scopeEntityId(scope: Scope): string {
  return viewSettingsEntityId(scope.scope_type, scope.scope_id);
}

/** Project the scope belongs to, for the activity row; null when it has none or the row is gone. */
function scopeProjectId(ctx: TesseraContext, scope: Scope): string | null {
  switch (scope.scope_type) {
    case "project":
    case "archived":
      return ctx.db.select({ id: project.id }).from(project).where(eq(project.id, scope.scope_id)).get()?.id ?? null;
    case "cycle":
      return ctx.db.select({ project_id: cycle.project_id }).from(cycle).where(eq(cycle.id, scope.scope_id)).get()?.project_id ?? null;
    case "module":
      return (
        ctx.db.select({ project_id: moduleTable.project_id }).from(moduleTable).where(eq(moduleTable.id, scope.scope_id)).get()?.project_id ??
        null
      );
    default:
      return null;
  }
}

function findRow(ctx: TesseraContext, scope: Scope) {
  return ctx.db
    .select()
    .from(view_settings)
    .where(and(eq(view_settings.scope_type, scope.scope_type), eq(view_settings.scope_id, scope.scope_id)))
    .get();
}

/** Stored settings parsed through their schemas, or the defaults when no row exists. */
function loadSettings(ctx: TesseraContext, scope: Scope): ViewSettings {
  const row = findRow(ctx, scope);
  if (!row) return defaultViewSettings();
  return { filters: FiltersSchema.parse(row.filters), display: DisplaySchema.parse(row.display) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getViewSettings(ctx: TesseraContext, scope_type: ViewSettingsScope, scope_id: string): ViewSettings {
  const scope = validateInput(ViewSettingsScopeInput, { scope_type, scope_id });
  return loadSettings(ctx, scope);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const SaveViewSettingsInput = z
  .object({
    filters: FiltersSchema.optional().describe("Filter keys merged over the stored filters; an empty list clears a key."),
    display: DisplayPatchSchema.optional().describe("Display keys merged over the stored display."),
  })
  .strict();

export type SaveViewSettingsInputType = z.input<typeof SaveViewSettingsInput>;

/** Upserts the row for the scope with the given keys merged over the stored ones; returns the merged settings. */
export function saveViewSettings(
  ctx: TesseraContext,
  scope_type: ViewSettingsScope,
  scope_id: string,
  input: SaveViewSettingsInputType,
): ViewSettings {
  const scope = validateInput(ViewSettingsScopeInput, { scope_type, scope_id });
  const data = validateInput(SaveViewSettingsInput, input);
  return withTx(ctx, () => {
    const before = loadSettings(ctx, scope);
    const after: ViewSettings = {
      filters: mergeFilters(before.filters, data.filters ?? {}),
      display: mergeDisplay(before.display, data.display ?? {}),
    };
    const now = ctx.now();
    ctx.db
      .insert(view_settings)
      .values({ scope_type: scope.scope_type, scope_id: scope.scope_id, filters: after.filters, display: after.display, updated_at: now })
      .onConflictDoUpdate({
        target: [view_settings.scope_type, view_settings.scope_id],
        set: { filters: after.filters, display: after.display, updated_at: now },
      })
      .run();
    diffFields(
      ctx,
      { project_id: scopeProjectId(ctx, scope), entity_type: "view_settings", entity_id: scopeEntityId(scope) },
      before,
      after,
      ["filters", "display"],
    );
    return after;
  });
}

/** Removes the stored row so the scope falls back to the defaults; a no-op when there is none. */
export function resetViewSettings(ctx: TesseraContext, scope_type: ViewSettingsScope, scope_id: string): ViewSettings {
  const scope = validateInput(ViewSettingsScopeInput, { scope_type, scope_id });
  return withTx(ctx, () => {
    const existing = findRow(ctx, scope);
    if (existing) {
      ctx.db
        .delete(view_settings)
        .where(and(eq(view_settings.scope_type, scope.scope_type), eq(view_settings.scope_id, scope.scope_id)))
        .run();
      logActivity(ctx, {
        project_id: scopeProjectId(ctx, scope),
        entity_type: "view_settings",
        entity_id: scopeEntityId(scope),
        verb: "deleted",
        comment: "reset to defaults",
      });
    }
    return defaultViewSettings();
  });
}
