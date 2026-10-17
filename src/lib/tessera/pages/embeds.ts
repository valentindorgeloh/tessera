/**
 * Entity links in a page body become page_embed rows (decision 44).
 * Links inside fenced code are ignored.
 */
import { eq } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { page_embed } from "../db/schema";
import type { PageEmbedType } from "../types";
import { getWorkItemByKey } from "../work-items";
import { isTrackerError } from "../core/errors";
import { loadPage } from "./model";

const SCHEMES = ["work", "page", "cycle", "module"] as const;

/** Unique entity refs outside fenced code. `work:KEY` is not resolved here. */
export function extractEntityRefs(markdown: string): { scheme: (typeof SCHEMES)[number]; ref: string }[] {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, "");
  const seen = new Set<string>();
  const out: { scheme: (typeof SCHEMES)[number]; ref: string }[] = [];
  for (const match of withoutFences.matchAll(/\]\((work|page|cycle|module):([^)\s]+)\)/g)) {
    const scheme = match[1] as (typeof SCHEMES)[number];
    const ref = match[2] ?? "";
    const key = `${scheme}:${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scheme, ref });
  }
  return out;
}

/** Replaces the page's embed rows with the links the body can resolve. */
export function replacePageEmbeds(ctx: TesseraContext, pageId: string, markdown: string): void {
  const self = loadPage(ctx, pageId);
  ctx.db.delete(page_embed).where(eq(page_embed.page_id, pageId)).run();
  for (const link of extractEntityRefs(markdown)) {
    const resolved = resolve(ctx, pageId, link.scheme, link.ref);
    if (!resolved) continue;
    if (resolved.entity_type === "page" && resolved.entity_id === self.id) continue;
    ctx.db.insert(page_embed).values({ page_id: pageId, entity_type: resolved.entity_type, entity_id: resolved.entity_id }).run();
  }
}

function resolve(ctx: TesseraContext, pageId: string, scheme: (typeof SCHEMES)[number], ref: string): { entity_type: PageEmbedType; entity_id: string } | null {
  if (scheme === "work") {
    try {
      return { entity_type: "work_item", entity_id: getWorkItemByKey(ctx, ref).id };
    } catch (err) {
      if (isTrackerError(err)) return null;
      throw err;
    }
  }
  const table = scheme === "page" ? "page" : scheme === "cycle" ? "cycle" : "module";
  const row = ctx.sqlite.prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(ref) as { id: string } | undefined;
  if (!row) return null;
  if (scheme === "page" && row.id === pageId) return null;
  return { entity_type: scheme, entity_id: row.id };
}
