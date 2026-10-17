/**
 * Handbook import into wiki pages.
 *
 * ASSUMPTION: `page` has no `external_source` or `external_id` column, so this
 * module does not add one and does not generate a migration. A rerun skips a
 * slug when a live page already has the created activity comment
 * `Imported from content/<file>`. If both columns are present they are the
 * source of truth (`external_source` "handbook", `external_id` the slug) and
 * the comment is still written.
 *
 * Ids are allocated before insert so `item:` links can be rewritten first.
 * `createPage` mints its own id, so the insert repeats that function's row and
 * then calls the same side effects: FTS, `writePageVersion`, the created
 * activity row, and `replacePageEmbeds` once every new page exists (a link may
 * point at a page later in the batch).
 */
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { newId } from "./core/ids";
import { sortOrderAfter } from "./core/order";
import { withTx } from "./core/tx";
import { upsertPageFts } from "./db/fts";
import { page } from "./db/schema";
import { loadPage, replacePageEmbeds, writePageVersion } from "./pages";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMPORT_COMMENT_PREFIX = "Imported from content/";
const BREAKS_ONLY = /^(?:\s|<br\s*\/?>)*$/i;

export type HandbookEntry = {
  slug: string;
  file: string;
  title: string;
  kind: string;
  parent: string | null;
  summary: string;
  order: number;
  updated: string | null;
  body: string;
};

export type HandbookPlan = {
  /** Topological order: parents before children, siblings by order then title. */
  create: HandbookEntry[];
  skipped: string[];
  warnings: string[];
};

export type HandbookImportResult = {
  created: { slug: string; id: string }[];
  skipped: string[];
  warnings: string[];
};

type HandbookParseError = { error: string };

function isHandbookEntry(value: HandbookEntry | HandbookParseError): value is HandbookEntry {
  return !("error" in value);
}

function isFrontmatterError(value: Record<string, string> | HandbookParseError): value is HandbookParseError {
  return typeof value.error === "string" && Object.keys(value).every((key) => key === "error");
}

/** Same line grammar as the handbook front-matter parser: `key: value`, JSON when the value is quoted. */
function parseFrontmatter(file: string, block: string): { fields: Record<string, string> } | HandbookParseError {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const splitAt = line.indexOf(":");
    if (splitAt === -1) continue;
    const key = line.slice(0, splitAt).trim();
    const raw = line.slice(splitAt + 1).trim();
    if (!raw.startsWith('"')) {
      fields[key] = raw;
      continue;
    }
    try {
      const value = JSON.parse(raw) as unknown;
      if (typeof value !== "string") return { error: `${file}: ${key} must be a string` };
      fields[key] = value;
    } catch {
      return { error: `${file}: invalid JSON value for ${key}` };
    }
  }
  return { fields };
}

export function parseHandbookFile(file: string, text: string): HandbookEntry | HandbookParseError {
  const match = text.match(FRONT_MATTER);
  if (!match) return { error: `${file}: missing front matter` };
  const parsed = parseFrontmatter(file, match[1] ?? "");
  if ("error" in parsed) return parsed;
  const fields = parsed.fields;
  const slug = (fields.id ?? "").trim();
  if (!SLUG.test(slug)) return { error: `${file}: invalid id` };
  const title = (fields.title ?? "").trim();
  if (!title) return { error: `${file}: missing title` };
  const kind = (fields.kind ?? "").trim();
  if (kind !== "item" && kind !== "collection") return { error: `${file}: invalid kind` };
  const parent = (fields.parent ?? "").trim();
  const updated = (fields.updated ?? "").trim();
  return {
    slug,
    file,
    title,
    kind,
    parent: parent ? parent : null,
    summary: fields.summary ?? "",
    order: Number(fields.order ?? "0") || 0,
    updated: updated ? updated : null,
    body: (match[2] ?? "").replace(/^\n/, "").replace(/\s+$/, ""),
  };
}

/** A non-empty summary becomes the first paragraph. A body of only `<br />` and whitespace becomes empty. */
function composeBody(summary: string, body: string): string {
  const normalised = BREAKS_ONLY.test(body) ? "" : body;
  const lead = summary.trim();
  if (!lead) return normalised;
  if (!normalised) return lead;
  return `${lead}\n\n${normalised}`;
}

function linkedSlugs(text: string): string[] {
  return [...text.matchAll(/\]\(item:([^)\s]+)\)/g)].map((match) => match[1] ?? "");
}

function rewriteItemLinks(text: string, ids: Map<string, string>): string {
  return text.replace(/\]\(item:([^)\s]+)\)/g, (full, slug: string) => {
    const id = ids.get(slug);
    return id ? `](page:${id})` : full;
  });
}

function bySibling(a: HandbookEntry, b: HandbookEntry): number {
  return a.order - b.order || a.title.localeCompare(b.title);
}

function topo(entries: HandbookEntry[]): { ordered: HandbookEntry[]; warnings: string[] } {
  const creating = new Set(entries.map((entry) => entry.slug));
  const byParent = new Map<string | null, HandbookEntry[]>();
  for (const entry of entries) {
    const key = entry.parent;
    const list = byParent.get(key) ?? [];
    list.push(entry);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort(bySibling);

  const ordered: HandbookEntry[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const entry of byParent.get(parent) ?? []) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      ordered.push(entry);
      walk(entry.slug);
    }
  };
  walk(null);
  for (const key of byParent.keys()) {
    if (key !== null && !creating.has(key)) walk(key);
  }

  const warnings: string[] = [];
  const rest = entries.filter((entry) => !seen.has(entry.slug)).sort(bySibling);
  for (const entry of rest) {
    if (seen.has(entry.slug)) continue;
    warnings.push(`Cycle involving "${entry.slug}"; placing the page at the top level`);
    ordered.push({ ...entry, parent: null });
    seen.add(entry.slug);
    walk(entry.slug);
  }
  return { ordered, warnings };
}

export function planHandbookImport(entries: readonly (HandbookEntry | HandbookParseError)[], existing: ReadonlySet<string>): HandbookPlan {
  const warnings: string[] = [];
  const parsed: HandbookEntry[] = [];
  for (const entry of entries) {
    if (!isHandbookEntry(entry)) {
      warnings.push(entry.error);
      continue;
    }
    parsed.push(entry);
  }

  const seen = new Set<string>();
  const unique: HandbookEntry[] = [];
  for (const entry of parsed) {
    if (seen.has(entry.slug)) {
      warnings.push(`Duplicate slug "${entry.slug}" in ${entry.file}`);
      continue;
    }
    seen.add(entry.slug);
    unique.push(entry);
  }

  const skipped: string[] = [];
  const fresh: HandbookEntry[] = [];
  for (const entry of unique) {
    if (existing.has(entry.slug)) skipped.push(entry.slug);
    else fresh.push(entry);
  }

  const adjusted: HandbookEntry[] = [];
  for (const entry of fresh) {
    let parent = entry.parent;
    if (parent === entry.slug) {
      warnings.push(`Page "${entry.slug}" lists itself as its parent; placing the page at the top level`);
      parent = null;
    } else if (parent && !seen.has(parent) && !existing.has(parent)) {
      warnings.push(`Unknown parent "${parent}" for "${entry.slug}"; placing the page at the top level`);
      parent = null;
    }
    adjusted.push({ ...entry, parent });
    const missing = new Set<string>();
    for (const slug of linkedSlugs(composeBody(entry.summary, entry.body))) {
      if (!seen.has(slug) && !existing.has(slug)) missing.add(slug);
    }
    for (const slug of missing) warnings.push(`Unknown item link "${slug}" in "${entry.slug}"`);
  }

  const tree = topo(adjusted);
  warnings.push(...tree.warnings);
  return { create: tree.ordered, skipped, warnings };
}

function importComment(file: string): string {
  return `${IMPORT_COMMENT_PREFIX}${path.basename(file)}`;
}

function pageHasExternalIds(ctx: TesseraContext): boolean {
  const columns = ctx.sqlite.prepare("PRAGMA table_info(page)").all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  return names.has("external_source") && names.has("external_id");
}

type ImportedPage = { slug: string; id: string };

function pagesFromColumns(ctx: TesseraContext): ImportedPage[] {
  if (!pageHasExternalIds(ctx)) return [];
  return ctx.sqlite
    .prepare(
      `SELECT id, external_id AS slug FROM page
       WHERE deleted_at IS NULL AND external_source = 'handbook' AND external_id IS NOT NULL`,
    )
    .all() as ImportedPage[];
}

function pagesFromComments(ctx: TesseraContext, entries: readonly HandbookEntry[]): ImportedPage[] {
  const idByFile = new Map<string, string>();
  const rows = ctx.sqlite
    .prepare(
      `SELECT p.id AS id, a.comment AS comment
       FROM activity a
       INNER JOIN page p ON p.id = a.entity_id AND p.deleted_at IS NULL
       WHERE a.entity_type = 'page' AND a.verb = 'created' AND a.comment LIKE ?
       ORDER BY a.seq DESC`,
    )
    .all(`${IMPORT_COMMENT_PREFIX}%`) as { id: string; comment: string }[];
  for (const row of rows) {
    const file = row.comment.slice(IMPORT_COMMENT_PREFIX.length);
    if (file && !idByFile.has(file)) idByFile.set(file, row.id);
  }
  const out: ImportedPage[] = [];
  for (const entry of entries) {
    const id = idByFile.get(path.basename(entry.file));
    if (id) out.push({ slug: entry.slug, id });
  }
  return out;
}

/** Slugs already imported, from the external columns when they exist and from activity comments otherwise. */
export function importedHandbookSlugs(ctx: TesseraContext, entries: readonly HandbookEntry[]): Set<string> {
  const slugs = new Set<string>();
  for (const row of pagesFromColumns(ctx)) slugs.add(row.slug);
  for (const row of pagesFromComments(ctx, entries)) slugs.add(row.slug);
  return slugs;
}

function importedPageIds(ctx: TesseraContext, entries: readonly HandbookEntry[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const row of pagesFromColumns(ctx)) ids.set(row.slug, row.id);
  for (const row of pagesFromComments(ctx, entries)) if (!ids.has(row.slug)) ids.set(row.slug, row.id);
  return ids;
}

function lastSiblingKey(ctx: TesseraContext, parentId: string | null): string | null {
  const rows = ctx.db
    .select({ sort_order: page.sort_order })
    .from(page)
    .where(and(isNull(page.project_id), parentId === null ? isNull(page.parent_id) : eq(page.parent_id, parentId), isNull(page.deleted_at)))
    .all()
    .map((row) => row.sort_order)
    .sort();
  return rows.at(-1) ?? null;
}

function insertImportedPage(
  ctx: TesseraContext,
  input: { id: string; parentId: string | null; name: string; body: string; updatedAt: string | null; file: string; slug: string },
): void {
  const now = ctx.now();
  ctx.db
    .insert(page)
    .values({
      id: input.id,
      project_id: null,
      parent_id: input.parentId,
      name: input.name,
      description_md: input.body,
      description_version: 0,
      access: "public",
      is_locked: false,
      logo: null,
      sort_order: sortOrderAfter(lastSiblingKey(ctx, input.parentId)),
      created_at: now,
      updated_at: input.updatedAt ?? now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .run();
  if (pageHasExternalIds(ctx)) {
    ctx.sqlite.prepare("UPDATE page SET external_source = ?, external_id = ? WHERE id = ?").run("handbook", input.slug, input.id);
  }
  const row = loadPage(ctx, input.id);
  upsertPageFts(ctx.sqlite, { id: input.id, project_id: null, name: input.name, body: input.body });
  writePageVersion(ctx, row, input.body);
  logActivity(ctx, {
    project_id: null,
    entity_type: "page",
    entity_id: input.id,
    verb: "created",
    new_identifier: input.name,
    comment: importComment(input.file),
  });
}

export function importHandbook(ctx: TesseraContext, entries: readonly HandbookEntry[]): HandbookImportResult {
  return withTx(ctx, () => {
    const plan = planHandbookImport(entries, importedHandbookSlugs(ctx, entries));
    const ids = importedPageIds(ctx, entries);
    for (const entry of plan.create) ids.set(entry.slug, newId());

    const created: { slug: string; id: string; body: string }[] = [];
    for (const entry of plan.create) {
      const id = ids.get(entry.slug);
      if (!id) throw new Error(`Handbook page "${entry.slug}" has no id`);
      let parentId: string | null = null;
      if (entry.parent) {
        parentId = ids.get(entry.parent) ?? null;
        if (!parentId) throw new Error(`Handbook parent "${entry.parent}" has no page id`);
      }
      const body = rewriteItemLinks(composeBody(entry.summary, entry.body), ids);
      insertImportedPage(ctx, {
        id,
        parentId,
        name: entry.title,
        body,
        updatedAt: entry.updated,
        file: entry.file,
        slug: entry.slug,
      });
      created.push({ slug: entry.slug, id, body });
    }
    for (const row of created) {
      if (row.body) replacePageEmbeds(ctx, row.id, row.body);
    }
    return {
      created: created.map(({ slug, id }) => ({ slug, id })),
      skipped: plan.skipped,
      warnings: plan.warnings,
    };
  });
}
