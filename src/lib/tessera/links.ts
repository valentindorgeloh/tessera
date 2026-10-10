/**
 * Links on work items and modules (docs/contracts/service-api.md "links.ts",
 * schema.md `work_item_link` and `module_link`). One API over both tables: a
 * link belongs to exactly one parent, its url must parse as an absolute
 * http(s) URL, `sort_order` is a fractional key appended per parent, and every
 * change is logged as activity on the parent entity. Archived parents and
 * archived projects are read-only.
 */
import { and, asc, count, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity, type ActivityTarget } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, notFound, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { formatKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter } from "./core/order";
import { withTx } from "./core/tx";
import { moduleTable, module_link, project, work_item, work_item_link } from "./db/schema";
import { IdSchema, LinkMetadataSchema } from "./schemas";
import type { LinkMetadata, ModuleLinkRow, WorkItemLinkRow } from "./types";

export type LinkParentType = "work_item" | "module";

type LinkBase = {
  id: string;
  title: string;
  url: string;
  metadata: LinkMetadata | null;
  sort_order: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
};

/** View model over `work_item_link` and `module_link`; `parent_type` says which parent column is set. */
export type Link = LinkBase &
  ({ parent_type: "work_item"; work_item_id: string; module_id: null } | { parent_type: "module"; work_item_id: null; module_id: string });

const LINK_TITLE = z.string().trim().max(500);
const LINK_URL_MAX = 2048;

/** True for an absolute http or https URL that the URL parser accepts and that carries no whitespace. */
export function isHttpUrl(value: string): boolean {
  // The parser silently drops tabs and newlines and accepts "http:example.com"; both guards keep the stored text honest.
  if (/\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const LINK_URL = z.string().trim().min(1).max(LINK_URL_MAX).refine(isHttpUrl, { message: "expected an absolute http(s) URL" });

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** Title, url and metadata of a link; shared by addLink and the module wrappers. */
export const LinkFieldsInput = z
  .object({
    title: LINK_TITLE.optional().describe("Display title; empty by default, in which case the UI shows the URL."),
    url: LINK_URL.describe("Absolute http(s) URL."),
    metadata: LinkMetadataSchema.optional().describe("Free-form metadata, e.g. a fetched page title or favicon."),
  })
  .strict();

export type LinkFieldsInputType = z.input<typeof LinkFieldsInput>;

function exactlyOneParent(value: { work_item_id?: string; module_id?: string }): boolean {
  return (value.work_item_id === undefined) !== (value.module_id === undefined);
}

const ONE_PARENT_MESSAGE = "exactly one of work_item_id or module_id is required";

export const AddLinkInput = LinkFieldsInput.extend({
  work_item_id: IdSchema.optional().describe("Work item the link belongs to (exactly one of work_item_id and module_id)."),
  module_id: IdSchema.optional().describe("Module the link belongs to (exactly one of work_item_id and module_id)."),
})
  .strict()
  .refine(exactlyOneParent, { message: ONE_PARENT_MESSAGE });

export type AddLinkInputType = z.input<typeof AddLinkInput>;

export const UpdateLinkInput = z
  .object({
    title: LINK_TITLE.describe("New display title."),
    url: LINK_URL.describe("New absolute http(s) URL."),
    metadata: LinkMetadataSchema.nullable().describe("New metadata, or null to clear it."),
  })
  .partial()
  .strict();

export type UpdateLinkInputType = z.input<typeof UpdateLinkInput>;

export const ListLinksInput = z
  .object({
    work_item_id: IdSchema.optional().describe("List the links of this work item."),
    module_id: IdSchema.optional().describe("List the links of this module."),
  })
  .strict()
  .refine(exactlyOneParent, { message: ONE_PARENT_MESSAGE });

export type ListLinksInputType = z.input<typeof ListLinksInput>;

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

type ParentRef = { type: LinkParentType; id: string };

type LinkParent = ParentRef & {
  project_id: string;
  /** WEB-12 for a work item, the name for a module. */
  label: string;
  archived: boolean;
  project_archived: boolean;
};

function parentRefFromInput(input: { work_item_id?: string; module_id?: string }): ParentRef {
  if (input.work_item_id !== undefined) return { type: "work_item", id: input.work_item_id };
  if (input.module_id !== undefined) return { type: "module", id: input.module_id };
  // Unreachable after schema validation; kept so the function is total.
  throw validation([{ code: "custom", path: [], message: ONE_PARENT_MESSAGE }], `Invalid input: ${ONE_PARENT_MESSAGE}`);
}

function parentRefOf(link: Link): ParentRef {
  return link.parent_type === "work_item" ? { type: "work_item", id: link.work_item_id } : { type: "module", id: link.module_id };
}

function loadWorkItemParent(ctx: TesseraContext, id: string): LinkParent {
  const row = ctx.db
    .select({
      project_id: work_item.project_id,
      sequence_id: work_item.sequence_id,
      archived_at: work_item.archived_at,
      identifier: project.identifier,
      project_archived_at: project.archived_at,
    })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(and(eq(work_item.id, id), isNull(work_item.deleted_at)))
    .get();
  if (!row) throw notFound("work_item", id);
  return {
    type: "work_item",
    id,
    project_id: row.project_id,
    label: formatKey(row.identifier, row.sequence_id),
    archived: row.archived_at !== null,
    project_archived: row.project_archived_at !== null,
  };
}

function loadModuleParent(ctx: TesseraContext, id: string): LinkParent {
  const row = ctx.db
    .select({
      project_id: moduleTable.project_id,
      name: moduleTable.name,
      archived_at: moduleTable.archived_at,
      project_archived_at: project.archived_at,
    })
    .from(moduleTable)
    .innerJoin(project, eq(moduleTable.project_id, project.id))
    .where(and(eq(moduleTable.id, id), isNull(moduleTable.deleted_at)))
    .get();
  if (!row) throw notFound("module", id);
  return {
    type: "module",
    id,
    project_id: row.project_id,
    label: row.name,
    archived: row.archived_at !== null,
    project_archived: row.project_archived_at !== null,
  };
}

/** Non-deleted parent; NOT_FOUND otherwise. */
function loadParent(ctx: TesseraContext, ref: ParentRef): LinkParent {
  return ref.type === "work_item" ? loadWorkItemParent(ctx, ref.id) : loadModuleParent(ctx, ref.id);
}

/** Archived parents and archived projects are read-only. */
function loadWritableParent(ctx: TesseraContext, ref: ParentRef): LinkParent {
  const parent = loadParent(ctx, ref);
  if (parent.project_archived) throw archived(`the project of ${parent.type} ${parent.label} is archived`);
  if (parent.archived) throw archived(`${parent.type} ${parent.label} is archived`);
  return parent;
}

function activityTarget(parent: LinkParent): ActivityTarget {
  return {
    project_id: parent.project_id,
    entity_type: parent.type,
    entity_id: parent.id,
    work_item_id: parent.type === "work_item" ? parent.id : null,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type LinkColumns = Omit<WorkItemLinkRow, "work_item_id">;

/** JSON columns are never read without their schema; unreadable metadata reads as null. */
function parseMetadata(raw: unknown): LinkMetadata | null {
  if (raw === null || raw === undefined) return null;
  const parsed = LinkMetadataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function linkBase(row: LinkColumns): LinkBase {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    metadata: parseMetadata(row.metadata),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    deleted_at: row.deleted_at,
  };
}

function fromWorkItemLinkRow(row: WorkItemLinkRow): Link {
  return { ...linkBase(row), parent_type: "work_item", work_item_id: row.work_item_id, module_id: null };
}

function fromModuleLinkRow(row: ModuleLinkRow): Link {
  return { ...linkBase(row), parent_type: "module", work_item_id: null, module_id: row.module_id };
}

/** What the activity log shows for a link: its title, or the URL when the title is empty. */
export function linkLabel(link: Pick<Link, "title" | "url">): string {
  return link.title.length > 0 ? link.title : link.url;
}

function activeWorkItemLinks(workItemId: string): SQL {
  return sql`${work_item_link.work_item_id} = ${workItemId} AND ${work_item_link.deleted_at} IS NULL`;
}

function activeModuleLinks(moduleId: string): SQL {
  return sql`${module_link.module_id} = ${moduleId} AND ${module_link.deleted_at} IS NULL`;
}

function findLink(ctx: TesseraContext, id: string): Link | undefined {
  const itemLink = ctx.db
    .select()
    .from(work_item_link)
    .where(and(eq(work_item_link.id, id), isNull(work_item_link.deleted_at)))
    .get();
  if (itemLink) return fromWorkItemLinkRow(itemLink);
  const moduleLink = ctx.db
    .select()
    .from(module_link)
    .where(and(eq(module_link.id, id), isNull(module_link.deleted_at)))
    .get();
  return moduleLink ? fromModuleLinkRow(moduleLink) : undefined;
}

/** Non-deleted link by id from either table; NOT_FOUND otherwise. */
export function getLink(ctx: TesseraContext, id: string): Link {
  const link = findLink(ctx, id);
  if (!link) throw notFound("link", id);
  return link;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Non-deleted links of one parent in display order; NOT_FOUND when the parent does not exist. */
export function listLinks(ctx: TesseraContext, input: ListLinksInputType): Link[] {
  const data = validateInput(ListLinksInput, input);
  const parent = loadParent(ctx, parentRefFromInput(data));
  if (parent.type === "work_item") {
    return ctx.db
      .select()
      .from(work_item_link)
      .where(activeWorkItemLinks(parent.id))
      .orderBy(asc(work_item_link.sort_order), asc(work_item_link.created_at))
      .all()
      .map(fromWorkItemLinkRow);
  }
  return ctx.db
    .select()
    .from(module_link)
    .where(activeModuleLinks(parent.id))
    .orderBy(asc(module_link.sort_order), asc(module_link.created_at))
    .all()
    .map(fromModuleLinkRow);
}

/** Non-deleted link count per parent id; ids without links map to 0. */
export function countLinks(ctx: TesseraContext, type: LinkParentType, parentIds: readonly string[]): Map<string, number> {
  const result = new Map(parentIds.map((id) => [id, 0]));
  if (parentIds.length === 0) return result;
  const rows =
    type === "work_item"
      ? ctx.db
          .select({ parent_id: work_item_link.work_item_id, n: count() })
          .from(work_item_link)
          .where(and(inArray(work_item_link.work_item_id, parentIds), isNull(work_item_link.deleted_at)))
          .groupBy(work_item_link.work_item_id)
          .all()
      : ctx.db
          .select({ parent_id: module_link.module_id, n: count() })
          .from(module_link)
          .where(and(inArray(module_link.module_id, parentIds), isNull(module_link.deleted_at)))
          .groupBy(module_link.module_id)
          .all();
  for (const row of rows) result.set(row.parent_id, row.n);
  return result;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function addLink(ctx: TesseraContext, input: AddLinkInputType): Link {
  const data = validateInput(AddLinkInput, input);
  return withTx(ctx, () => {
    const parent = loadWritableParent(ctx, parentRefFromInput(data));
    const now = ctx.now();
    const columns = {
      id: newId(),
      title: data.title ?? "",
      url: data.url,
      metadata: data.metadata ?? null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    };
    const link =
      parent.type === "work_item"
        ? fromWorkItemLinkRow(
            ctx.db
              .insert(work_item_link)
              .values({
                ...columns,
                work_item_id: parent.id,
                sort_order: sortOrderAfter(lastSortOrder(ctx.db, work_item_link, activeWorkItemLinks(parent.id))),
              })
              .returning()
              .get(),
          )
        : fromModuleLinkRow(
            ctx.db
              .insert(module_link)
              .values({
                ...columns,
                module_id: parent.id,
                sort_order: sortOrderAfter(lastSortOrder(ctx.db, module_link, activeModuleLinks(parent.id))),
              })
              .returning()
              .get(),
          );
    logActivity(ctx, { ...activityTarget(parent), verb: "added", field: "link", new_value: link.id, new_identifier: linkLabel(link) });
    return link;
  });
}

/** The link's own columns under the field names the parent's activity log uses. */
type LinkFields = { link_title: string; link_url: string; link_metadata: LinkMetadata | null };

const LINK_FIELDS = ["link_title", "link_url", "link_metadata"] as const;

function linkFields(link: Link): LinkFields {
  return { link_title: link.title, link_url: link.url, link_metadata: link.metadata };
}

export function updateLink(ctx: TesseraContext, id: string, patch: UpdateLinkInputType): Link {
  const data = validateInput(UpdateLinkInput, patch);
  return withTx(ctx, () => {
    const before = getLink(ctx, id);
    const parent = loadWritableParent(ctx, parentRefOf(before));
    const now = ctx.now();
    const changes = {
      title: data.title ?? before.title,
      url: data.url ?? before.url,
      metadata: data.metadata === undefined ? before.metadata : data.metadata,
      updated_at: now,
      updated_by: ctx.actor.id,
    };
    const after =
      before.parent_type === "work_item"
        ? fromWorkItemLinkRow(ctx.db.update(work_item_link).set(changes).where(eq(work_item_link.id, id)).returning().get())
        : fromModuleLinkRow(ctx.db.update(module_link).set(changes).where(eq(module_link.id, id)).returning().get());
    diffFields(ctx, activityTarget(parent), linkFields(before), linkFields(after), LINK_FIELDS, (field, value) =>
      field !== "link_metadata" && typeof value === "string" && value.length > 0 ? value : null,
    );
    return after;
  });
}

/** Soft-deletes the link and logs `removed` on its parent. */
export function removeLink(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const link = getLink(ctx, id);
    const parent = loadWritableParent(ctx, parentRefOf(link));
    const now = ctx.now();
    const stamp = { deleted_at: now, updated_at: now, updated_by: ctx.actor.id };
    if (link.parent_type === "work_item") {
      ctx.db.update(work_item_link).set(stamp).where(eq(work_item_link.id, id)).run();
    } else {
      ctx.db.update(module_link).set(stamp).where(eq(module_link.id, id)).run();
    }
    logActivity(ctx, { ...activityTarget(parent), verb: "removed", field: "link", old_value: link.id, old_identifier: linkLabel(link) });
  });
}
