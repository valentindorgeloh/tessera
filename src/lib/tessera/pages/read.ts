/**
 * Page reads. Tree order is depth-first, siblings by sort_order (decision 40).
 */
import { and, asc, eq, isNull, like, sql } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { page, page_embed, page_version } from "../db/schema";
import type { PageBacklink, PageDetail, PageSummary, PageVersionInfo } from "../types";
import { embedsOf, loadPage, toSummary, type PageRecord } from "./model";
import type { z } from "zod";
import { ListPageBacklinksInput, ListPagesInput, ListPageVersionsInput } from "./model";

export function listPages(ctx: TesseraContext, input: z.input<typeof ListPagesInput>): PageSummary[] {
  const data = ListPagesInput.parse(input);
  const filters = [isNull(page.deleted_at)];
  filters.push(data.project_id === null ? isNull(page.project_id) : eq(page.project_id, data.project_id));
  if (data.tab === "archived") filters.push(sql`${page.archived_at} IS NOT NULL`);
  else {
    filters.push(isNull(page.archived_at));
    if (data.tab === "public") filters.push(eq(page.access, "public"));
    if (data.tab === "private") filters.push(eq(page.access, "private"));
  }
  if (data.parent_id !== undefined) {
    filters.push(data.parent_id === null ? isNull(page.parent_id) : eq(page.parent_id, data.parent_id));
  }
  if (data.search) filters.push(like(page.name, `%${data.search.replace(/[%_]/g, "")}%`));
  const rows = ctx.db.select().from(page).where(and(...filters)).orderBy(asc(page.sort_order)).all();
  if (data.parent_id !== undefined) return rows.map((row) => toSummary(ctx, row));
  return treeOrder(rows).map((row) => toSummary(ctx, row));
}

function treeOrder(rows: PageRecord[]): PageRecord[] {
  const byParent = new Map<string | null, PageRecord[]>();
  for (const row of rows) {
    const key = row.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  const out: PageRecord[] = [];
  const walk = (parent: string | null) => {
    for (const row of byParent.get(parent) ?? []) {
      out.push(row);
      walk(row.id);
    }
  };
  walk(null);
  return out;
}

export function pageAncestors(ctx: TesseraContext, row: PageRecord): { id: string; name: string }[] {
  const chain: { id: string; name: string }[] = [];
  let parentId = row.parent_id;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = ctx.db.select().from(page).where(and(eq(page.id, parentId), isNull(page.deleted_at))).get();
    if (!parent) break;
    chain.push({ id: parent.id, name: parent.name });
    parentId = parent.parent_id;
  }
  return chain.reverse();
}

export function getPage(ctx: TesseraContext, id: string): PageDetail {
  const row = loadPage(ctx, id);
  return {
    ...toSummary(ctx, row),
    description_md: row.description_md,
    description_version: row.description_version,
    ancestors: pageAncestors(ctx, row),
    embeds: embedsOf(ctx, row.id),
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

export function listPageBacklinks(ctx: TesseraContext, input: z.input<typeof ListPageBacklinksInput>): PageBacklink[] {
  const data = ListPageBacklinksInput.parse(input);
  const rows = ctx.db
    .select({ id: page.id, name: page.name, project_id: page.project_id, archived_at: page.archived_at })
    .from(page_embed)
    .innerJoin(page, eq(page.id, page_embed.page_id))
    .where(and(eq(page_embed.entity_type, data.entity_type), eq(page_embed.entity_id, data.entity_id), isNull(page.deleted_at)))
    .all();
  return rows;
}

export function listPageVersions(ctx: TesseraContext, input: z.input<typeof ListPageVersionsInput>): PageVersionInfo[] {
  const data = ListPageVersionsInput.parse(input);
  loadPage(ctx, data.page_id);
  const rows = ctx.db.select().from(page_version).where(eq(page_version.page_id, data.page_id)).orderBy(sql`${page_version.version} DESC`).limit(data.limit).all();
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    name: row.name,
    actor_id: row.actor_id,
    created_at: row.created_at,
    length: row.description_md.length,
    ...(data.include_body ? { description_md: row.description_md } : {}),
  }));
}
