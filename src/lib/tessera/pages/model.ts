/**
 * Page inputs and the view models the tools return (decisions 40–48).
 */
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { archived, locked, notFound, rule } from "../core/errors";
import { page, page_embed, page_label, project } from "../db/schema";
import { IdListSchema, IdSchema, LogoSchema, PageAccessSchema, PageEmbedTypeSchema, PageTabSchema } from "../schemas";
import type { PageDetail, PageRow, PageSummary } from "../types";

export const ListPagesInput = z
  .object({
    project_id: IdSchema.nullable().describe("Project, or null for the wiki."),
    tab: PageTabSchema.optional().describe("Public, private or archived. Omit for every page that is not archived."),
    parent_id: IdSchema.nullable().optional().describe("Only the children of this page, or only top-level pages when null."),
    search: z.string().max(200).optional().describe("Case-insensitive substring of the name."),
  })
  .strict();

export const PageIdInput = z.object({ page_id: IdSchema.describe("Page id.") }).strict();

export const CreatePageInput = z
  .object({
    project_id: IdSchema.nullable().describe("Project, or null for the wiki."),
    parent_id: IdSchema.nullable().optional().describe("Parent page in the same space, or null for the top level."),
    name: z.string().trim().min(1).max(255).default("Untitled").describe("Page title."),
    description_md: z.string().max(500_000).optional().describe("Markdown body."),
    access: PageAccessSchema.default("public").describe("Public or private. Access is a list tab (decision 42)."),
    logo: LogoSchema.nullable().optional().describe("Icon and palette colour."),
    label_ids: IdListSchema.optional().describe("Labels of the project. Wiki pages cannot carry labels."),
  })
  .strict();

export const UpdatePageInput = z
  .object({
    page_id: IdSchema.describe("Page id."),
    name: z.string().trim().min(1).max(255).optional().describe("Page title."),
    access: PageAccessSchema.optional().describe("Public or private."),
    logo: LogoSchema.nullable().optional().describe("Icon and colour, or null to clear."),
    label_ids: IdListSchema.optional().describe("Replaces the page's labels."),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.access !== undefined || value.logo !== undefined || value.label_ids !== undefined, {
    message: "at least one of name, access, logo or label_ids is required",
  });

export const UpdatePageBodyInput = z
  .object({
    page_id: IdSchema.describe("Page id."),
    description_md: z.string().max(500_000).describe("Markdown body."),
    expected_description_version: z.number().int().min(0).describe("description_version last read; CONFLICT when it moved."),
  })
  .strict();

export const MovePageInput = z
  .object({
    page_id: IdSchema.describe("Page to move. The whole subtree keeps its ids."),
    project_id: IdSchema.nullable().optional().describe("Target space. Omit to stay in the current one."),
    parent_id: IdSchema.nullable().optional().describe("Parent in the target space, or null for the top level."),
    before_id: IdSchema.optional().describe("Place immediately before this sibling."),
    after_id: IdSchema.optional().describe("Place immediately after this sibling."),
  })
  .strict();

export const ListPageVersionsInput = z
  .object({
    page_id: IdSchema.describe("Page id."),
    limit: z.number().int().min(1).max(100).default(20).describe("How many versions, newest first."),
    include_body: z.boolean().default(false).describe("Include description_md on each row."),
  })
  .strict();

export const RestorePageVersionInput = z
  .object({
    page_id: IdSchema.describe("Page id."),
    version_id: IdSchema.describe("Version row to restore."),
    expected_description_version: z.number().int().min(0).describe("description_version last read."),
  })
  .strict();

export const ListPageBacklinksInput = z
  .object({
    entity_type: PageEmbedTypeSchema.describe("work_item, page, cycle or module."),
    entity_id: IdSchema.describe("Entity id the pages link to."),
  })
  .strict();

export type PageRecord = PageRow;

export function loadPage(ctx: TesseraContext, id: string): PageRecord {
  const row = ctx.db.select().from(page).where(and(eq(page.id, id), isNull(page.deleted_at))).get();
  if (!row) throw notFound("page", id);
  return row;
}

/** Locked pages refuse content writes. Archived pages are read-only except unarchive and delete (decision 41). */
export function assertContentWritable(row: PageRecord): void {
  if (row.archived_at !== null) throw archived("This page is archived");
  if (row.is_locked) throw locked("This page is locked");
}

export function assertProjectWritable(ctx: TesseraContext, projectId: string | null): void {
  if (!projectId) return;
  const owner = ctx.db.select().from(project).where(and(eq(project.id, projectId), isNull(project.deleted_at))).get();
  if (!owner) throw notFound("project", projectId);
  if (owner.archived_at !== null) throw archived(`project ${owner.identifier} is archived`);
}

export function assertPagesEnabled(ctx: TesseraContext, projectId: string | null): void {
  if (!projectId) return;
  const owner = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  if (!owner || owner.deleted_at !== null) throw notFound("project", projectId);
  if (!owner.pages_enabled) throw rule("feature_disabled", "Pages are turned off for this project");
}

export function sameSpace(a: string | null, b: string | null): boolean {
  return a === b;
}

export function labelIds(ctx: TesseraContext, pageId: string): string[] {
  return ctx.db
    .select({ id: page_label.label_id })
    .from(page_label)
    .where(eq(page_label.page_id, pageId))
    .all()
    .map((row) => row.id);
}

export function childCount(ctx: TesseraContext, pageId: string): number {
  const row = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(page)
    .where(and(eq(page.parent_id, pageId), isNull(page.deleted_at)))
    .get();
  return Number(row?.n ?? 0);
}

export function toSummary(ctx: TesseraContext, row: PageRecord): PageSummary {
  return {
    id: row.id,
    project_id: row.project_id,
    parent_id: row.parent_id,
    name: row.name,
    access: row.access,
    is_locked: row.is_locked,
    logo: row.logo,
    archived_at: row.archived_at,
    sort_order: row.sort_order,
    label_ids: labelIds(ctx, row.id),
    child_count: childCount(ctx, row.id),
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  };
}

export function embedsOf(ctx: TesseraContext, pageId: string): PageDetail["embeds"] {
  return ctx.db
    .select({ entity_type: page_embed.entity_type, entity_id: page_embed.entity_id })
    .from(page_embed)
    .where(eq(page_embed.page_id, pageId))
    .all()
    .map((row) => ({ entity_type: row.entity_type as PageDetail["embeds"][number]["entity_type"], entity_id: row.entity_id }));
}
