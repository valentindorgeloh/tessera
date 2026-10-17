/**
 * Saved views (docs/contracts/service-api.md, schema.md "Views", plan
 * decision 20). A view is a named pair of `filters` and `display` JSON that
 * belongs to one project or, with `project_id NULL`, to the workspace.
 *
 * Rules
 *  - Names are unique per scope (case- and whitespace-insensitive, `name_key`).
 *    The partial unique index covers project views only, because SQLite treats
 *    NULL project_id as distinct, so workspace-view names are checked here.
 *  - Workspace views accept only `display.layout = "table"` (VALIDATION).
 *  - Locked views reject every change except `unlockView` (LOCKED).
 *  - `duplicateView` names the copy "Copy of <name>" ("Copy of <name> (2)"
 *    when taken) and copies description, filters, rich filters, display and logo.
 *  - Project views of an archived project are read-only (ARCHIVED).
 */
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, locked, notFound, rule, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { nameKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderForMove } from "./core/order";
import { withTx } from "./core/tx";
import { view } from "./db/schema";
import { assertFeatureEnabled, getProjectRow } from "./projects";
import { DEFAULT_DISPLAY, DisplaySchema, FiltersSchema, IdSchema, LogoSchema, RichFiltersSchema } from "./schemas";
import type { Display, ViewRow } from "./types";
import { DisplayPatchSchema, mergeDisplay, type DisplayPatch } from "./view-settings";

/** Row with its JSON columns parsed through their schemas. */
export type View = ViewRow;

/** The only layout a workspace view may use (plan decision 18). */
export const WORKSPACE_VIEW_LAYOUT = "table" as const;

export const COPY_NAME_PREFIX = "Copy of ";

const VIEW_NAME_MAX = 120;
const VIEW_NAME = z.string().trim().min(1).max(VIEW_NAME_MAX);
const VIEW_DESCRIPTION = z.string().trim().max(2000);

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Non-deleted views of one project, or the workspace views when `projectId` is null. */
function activeInScope(projectId: string | null): SQL {
  return projectId === null
    ? sql`${view.project_id} IS NULL AND ${view.deleted_at} IS NULL`
    : sql`${view.project_id} = ${projectId} AND ${view.deleted_at} IS NULL`;
}

function toView(row: ViewRow): View {
  return {
    ...row,
    filters: FiltersSchema.parse(row.filters),
    rich_filters: row.rich_filters === null ? null : RichFiltersSchema.parse(row.rich_filters),
    display: DisplaySchema.parse(row.display),
    logo: row.logo === null ? null : LogoSchema.parse(row.logo),
  };
}

function getViewRow(ctx: TesseraContext, id: string): ViewRow {
  const row = ctx.db
    .select()
    .from(view)
    .where(and(eq(view.id, id), isNull(view.deleted_at)))
    .get();
  if (!row) throw notFound("view", id);
  return row;
}

/**
 * NOT_FOUND for an unknown project; ARCHIVED for an archived one; nothing to
 * check for the workspace. `forCreate` also refuses while the project has
 * views turned off (RULE feature_disabled, decision 31): creates only, every
 * other write on existing views stays allowed.
 */
function assertWritableScope(ctx: TesseraContext, projectId: string | null, forCreate = false): void {
  if (projectId === null) return;
  const row = getProjectRow(ctx, projectId);
  if (row.archived_at !== null) throw archived(`project ${row.identifier} is archived`);
  if (forCreate) assertFeatureEnabled(row, "views");
}

function assertUnlocked(row: ViewRow): void {
  if (row.is_locked) throw locked(`view "${row.name}" is locked; unlock it first`);
}

function assertNameFree(ctx: TesseraContext, projectId: string | null, name: string, exceptId: string | null): string {
  const key = nameKey(name);
  const existing = ctx.db
    .select({ id: view.id, name: view.name })
    .from(view)
    .where(and(activeInScope(projectId), eq(view.name_key, key)))
    .get();
  if (existing && existing.id !== exceptId) {
    const where = projectId === null ? "in the workspace" : "in this project";
    throw conflict(`A view named "${existing.name}" already exists ${where}`, { id: existing.id });
  }
  return key;
}

function assertLayoutAllowed(projectId: string | null, display: Display): void {
  if (projectId !== null || display.layout === WORKSPACE_VIEW_LAYOUT) return;
  const message = `workspace views support only the ${WORKSPACE_VIEW_LAYOUT} layout`;
  throw validation([{ code: "custom", path: ["display", "layout"], message }], `Invalid input: display.layout: ${message}`);
}

/** Display of a new view: the patch over the defaults, table-first for the workspace. */
function initialDisplay(projectId: string | null, patch: DisplayPatch | undefined): Display {
  const base: Display = projectId === null ? { ...DEFAULT_DISPLAY, layout: WORKSPACE_VIEW_LAYOUT } : DEFAULT_DISPLAY;
  return mergeDisplay(base, patch ?? {});
}

function nextSortOrder(ctx: TesseraContext, projectId: string | null): string {
  return sortOrderAfter(lastSortOrder(ctx.db, view, activeInScope(projectId)));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const ListViewsInput = z
  .object({
    project_id: IdSchema.nullable().describe("Project whose views to list, or null for workspace views."),
  })
  .strict();

export type ListViewsInputType = z.input<typeof ListViewsInput>;

/** Non-deleted views of the scope in display order; NOT_FOUND when the project does not exist. */
export function listViews(ctx: TesseraContext, input: ListViewsInputType): View[] {
  const data = validateInput(ListViewsInput, input);
  if (data.project_id !== null) getProjectRow(ctx, data.project_id);
  return ctx.db
    .select()
    .from(view)
    .where(activeInScope(data.project_id))
    .orderBy(asc(view.sort_order), asc(view.created_at))
    .all()
    .map(toView);
}

/** Non-deleted view by id; NOT_FOUND otherwise. */
export function getView(ctx: TesseraContext, id: string): View {
  return toView(getViewRow(ctx, id));
}

// ---------------------------------------------------------------------------
// Create and update
// ---------------------------------------------------------------------------

export const CreateViewInput = z
  .object({
    project_id: IdSchema.nullable().describe("Project the view belongs to, or null for a workspace view."),
    name: VIEW_NAME.describe("View name, unique within its project or among workspace views (case-insensitive)."),
    description: VIEW_DESCRIPTION.optional().describe("Short description shown under the name."),
    filters: FiltersSchema.optional().describe("Saved filters; empty when omitted."),
    rich_filters: RichFiltersSchema.nullable().optional().describe("Stored only; lists and counts do not apply it until P10. Use filters."),
    display: DisplayPatchSchema.optional().describe("Display settings over the defaults; workspace views accept only layout table."),
    logo: LogoSchema.optional().describe("Icon and palette colour."),
  })
  .strict();

export type CreateViewInputType = z.input<typeof CreateViewInput>;

export function createView(ctx: TesseraContext, input: CreateViewInputType): View {
  const data = validateInput(CreateViewInput, input);
  const display = initialDisplay(data.project_id, data.display);
  assertLayoutAllowed(data.project_id, display);
  return withTx(ctx, () => {
    assertWritableScope(ctx, data.project_id, true);
    const key = assertNameFree(ctx, data.project_id, data.name, null);
    const now = ctx.now();
    const row = ctx.db
      .insert(view)
      .values({
        id: newId(),
        project_id: data.project_id,
        name: data.name,
        name_key: key,
        description: data.description ?? "",
        filters: data.filters ?? {},
        rich_filters: data.rich_filters ?? null,
        display,
        is_locked: false,
        logo: data.logo ?? null,
        sort_order: nextSortOrder(ctx, data.project_id),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: row.project_id, entity_type: "view", entity_id: row.id, verb: "created", new_identifier: row.name });
    return toView(row);
  });
}

export const UpdateViewInput = z
  .object({
    name: VIEW_NAME.describe("New name, unique within the view's scope."),
    description: VIEW_DESCRIPTION.describe("New description."),
    filters: FiltersSchema.describe("Replaces the saved filters."),
    rich_filters: RichFiltersSchema.nullable().describe("Stored only; lists and counts do not apply it until P10. Use filters."),
    display: DisplayPatchSchema.describe("Merged over the saved display; workspace views stay on layout table."),
    logo: LogoSchema.nullable().describe("Icon and colour, or null to clear."),
  })
  .partial()
  .strict();

export type UpdateViewInputType = z.input<typeof UpdateViewInput>;

const VIEW_UPDATE_FIELDS = ["name", "description", "filters", "rich_filters", "display", "logo"] as const;

export function updateView(ctx: TesseraContext, id: string, patch: UpdateViewInputType): View {
  const data = validateInput(UpdateViewInput, patch);
  return withTx(ctx, () => {
    const before = getView(ctx, id);
    assertWritableScope(ctx, before.project_id);
    assertUnlocked(before);
    const name = data.name ?? before.name;
    const key = data.name === undefined ? before.name_key : assertNameFree(ctx, before.project_id, name, id);
    const display = data.display === undefined ? before.display : mergeDisplay(before.display, data.display);
    assertLayoutAllowed(before.project_id, display);
    const now = ctx.now();
    const after = toView(
      ctx.db
        .update(view)
        .set({
          name,
          name_key: key,
          description: data.description ?? before.description,
          filters: data.filters ?? before.filters,
          rich_filters: data.rich_filters === undefined ? before.rich_filters : data.rich_filters,
          display,
          logo: data.logo === undefined ? before.logo : data.logo,
          updated_at: now,
          updated_by: ctx.actor.id,
        })
        .where(eq(view.id, id))
        .returning()
        .get(),
    );
    diffFields(ctx, { project_id: before.project_id, entity_type: "view", entity_id: id }, before, after, VIEW_UPDATE_FIELDS, (field, value) =>
      field === "name" && typeof value === "string" ? value : null,
    );
    return after;
  });
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

export const ReorderViewInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the view that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the view that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });

export type ReorderViewInputType = z.input<typeof ReorderViewInput>;

/**
 * Moves a view within its scope (the same project, or the workspace), as
 * `reorderState` does. Allowed on a locked view: `sort_order` is placement,
 * not view content. Neighbours outside the scope are NOT_FOUND.
 */
export function reorderView(ctx: TesseraContext, id: string, input: ReorderViewInputType): View {
  const data = validateInput(ReorderViewInput, input);
  return withTx(ctx, () => {
    const before = getView(ctx, id);
    assertWritableScope(ctx, before.project_id);
    const ordered = listViews(ctx, { project_id: before.project_id });
    const sortOrder = sortOrderForMove(ordered, id, data.before_id, data.after_id, "view");
    const now = ctx.now();
    const after = toView(
      ctx.db
        .update(view)
        .set({ sort_order: sortOrder, updated_at: now, updated_by: ctx.actor.id })
        .where(eq(view.id, id))
        .returning()
        .get(),
    );
    diffFields(ctx, { project_id: before.project_id, entity_type: "view", entity_id: id }, before, after, ["sort_order"], () => before.name);
    return after;
  });
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/** `base` cut so that `base + suffix` fits the name limit. */
function fitName(base: string, suffix: string): string {
  const room = VIEW_NAME_MAX - suffix.length;
  const head = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${head}${suffix}`;
}

/** "Copy of <name>", then "Copy of <name> (2)", "(3)", ... until a free name is found. */
function copyName(ctx: TesseraContext, projectId: string | null, sourceName: string): string {
  const taken = new Set(
    ctx.db
      .select({ name_key: view.name_key })
      .from(view)
      .where(activeInScope(projectId))
      .all()
      .map((row) => row.name_key),
  );
  const base = `${COPY_NAME_PREFIX}${sourceName}`;
  for (let n = 1; ; n += 1) {
    const candidate = fitName(base, n === 1 ? "" : ` (${n})`);
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

/** Creates an unlocked copy at the end of the same scope; the source may be locked. */
export function duplicateView(ctx: TesseraContext, id: string): View {
  return withTx(ctx, () => {
    const source = getView(ctx, id);
    assertWritableScope(ctx, source.project_id, true);
    const name = copyName(ctx, source.project_id, source.name);
    const now = ctx.now();
    const row = ctx.db
      .insert(view)
      .values({
        id: newId(),
        project_id: source.project_id,
        name,
        name_key: nameKey(name),
        description: source.description,
        filters: source.filters,
        rich_filters: source.rich_filters,
        display: source.display,
        is_locked: false,
        logo: source.logo,
        sort_order: nextSortOrder(ctx, source.project_id),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, {
      project_id: row.project_id,
      entity_type: "view",
      entity_id: row.id,
      verb: "copied",
      old_value: source.id,
      old_identifier: source.name,
      new_identifier: row.name,
    });
    return toView(row);
  });
}

// ---------------------------------------------------------------------------
// Lock, unlock, delete
// ---------------------------------------------------------------------------

function setLocked(ctx: TesseraContext, id: string, isLocked: boolean): View {
  const now = ctx.now();
  return toView(
    ctx.db
      .update(view)
      .set({ is_locked: isLocked, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(view.id, id))
      .returning()
      .get(),
  );
}

export function lockView(ctx: TesseraContext, id: string): View {
  return withTx(ctx, () => {
    const before = getViewRow(ctx, id);
    assertWritableScope(ctx, before.project_id);
    assertUnlocked(before);
    const after = setLocked(ctx, id, true);
    logActivity(ctx, { project_id: before.project_id, entity_type: "view", entity_id: id, verb: "locked", new_identifier: before.name });
    return after;
  });
}

export function unlockView(ctx: TesseraContext, id: string): View {
  return withTx(ctx, () => {
    const before = getViewRow(ctx, id);
    assertWritableScope(ctx, before.project_id);
    if (!before.is_locked) throw rule("not_locked", `view "${before.name}" is not locked`);
    const after = setLocked(ctx, id, false);
    logActivity(ctx, { project_id: before.project_id, entity_type: "view", entity_id: id, verb: "unlocked", new_identifier: before.name });
    return after;
  });
}

/** Soft-deletes the view; the name becomes reusable in its scope. */
export function deleteView(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const before = getViewRow(ctx, id);
    assertWritableScope(ctx, before.project_id);
    assertUnlocked(before);
    const now = ctx.now();
    ctx.db.update(view).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(view.id, id)).run();
    logActivity(ctx, { project_id: before.project_id, entity_type: "view", entity_id: id, verb: "deleted", old_identifier: before.name });
  });
}
