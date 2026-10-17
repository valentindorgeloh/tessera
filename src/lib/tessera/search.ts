/**
 * Global search (docs/contracts/service-api.md "search.ts"): one ranked list
 * over work items and pages (FTS5 through db/fts.ts) plus cycles, modules,
 * projects and views (name LIKE). An exact work item key such as WEB-12 always ranks
 * first, an exact name match next, then full-text hits in relevance order,
 * then name matches. Deleted entities never appear; archived ones (and items
 * of archived projects) only with `include_archived`. Items in the hidden
 * triage state are left out, as every list leaves them out.
 */
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { TesseraContext } from "./core/context";
import { validateInput } from "./core/errors";
import { formatKey, nameKey, normalizeIdentifier, parseKey } from "./core/keys";
import { searchPageIds, searchWorkItemIds } from "./db/fts";
import { cycle, moduleTable, page, project, state, view, work_item } from "./db/schema";
import { IdSchema } from "./schemas";

export const SEARCH_TYPES = ["work_item", "page", "cycle", "module", "project", "view"] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export const SearchTypeSchema = z.enum(SEARCH_TYPES);

export type SearchHit = {
  type: SearchType;
  id: string;
  /** Null for wiki pages. */
  project_id: string | null;
  /** WEB-12 for work items, the identifier for projects. */
  key?: string;
  title: string;
  /** Project name, state, or "Wiki"; whatever helps tell hits apart. */
  subtitle?: string;
  /** Higher ranks first; see the score constants for the bands. */
  score: number;
};

export const SearchScopeSchema = z
  .object({
    project_id: IdSchema.optional().describe("Only entities of this project (wiki pages are left out)."),
  })
  .strict();

export const SearchAllInput = z
  .object({
    q: z.string().max(500).describe("Free text, or a work item key such as WEB-12."),
    scope: SearchScopeSchema.optional().describe("Narrows the search to one project."),
    types: z.array(SearchTypeSchema).min(1).optional().describe("Entity kinds to search; all when omitted."),
    limit: z.number().int().min(1).max(200).optional().describe("Most hits to return across all kinds (default 20)."),
    include_archived: z.boolean().optional().describe("Also return archived entities and items of archived projects."),
  })
  .strict();

export type SearchAllInputType = z.input<typeof SearchAllInput>;

export type SearchAllOptions = Omit<SearchAllInputType, "q">;

export const DEFAULT_SEARCH_LIMIT = 20;

/** Score bands: a key hit beats an exact name, which beats full-text relevance, which beats a name fragment. */
export const KEY_MATCH_SCORE = 1000;
export const EXACT_NAME_SCORE = 500;
export const FTS_TOP_SCORE = 100;
export const NAME_PREFIX_SCORE = 80;
export const NAME_CONTAINS_SCORE = 60;

type SearchQuery = {
  q: string;
  /** Lower-cased, whitespace-collapsed query for name comparisons. */
  key: string;
  projectId: string | null;
  limit: number;
  includeArchived: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Relevance score for the n-th full-text hit (best first), never below 1. */
function ftsScore(rank: number): number {
  return Math.max(FTS_TOP_SCORE - rank, 1);
}

/** Score for a name hit: exact, prefix or anywhere. */
function nameScore(name: string, query: SearchQuery): number {
  const key = nameKey(name);
  if (key === query.key) return EXACT_NAME_SCORE;
  if (key.startsWith(query.key)) return NAME_PREFIX_SCORE;
  return NAME_CONTAINS_SCORE;
}

/** `%`, `_` and the escape character itself are literal in the user's text. */
function likePattern(key: string): string {
  return `%${key.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Case-insensitive "contains" on a name column with the user's text escaped. */
function nameLike(column: SQLiteColumn, query: SearchQuery): SQL {
  return sql`lower(${column}) LIKE ${likePattern(query.key)} ESCAPE '\\'`;
}

/** Archived rows are hidden unless asked for. */
function notArchived(column: SQLiteColumn, query: SearchQuery): SQL | undefined {
  return query.includeArchived ? undefined : isNull(column);
}

function liveProject(query: SearchQuery): SQL | undefined {
  return and(isNull(project.deleted_at), notArchived(project.archived_at, query));
}

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

const WORK_ITEM_COLUMNS = {
  id: work_item.id,
  project_id: work_item.project_id,
  sequence_id: work_item.sequence_id,
  name: work_item.name,
  identifier: project.identifier,
  project_name: project.name,
  state_name: state.name,
};

function workItemQuery(ctx: TesseraContext, query: SearchQuery, extra: SQL) {
  return ctx.db
    .select(WORK_ITEM_COLUMNS)
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(
      and(
        extra,
        isNull(work_item.deleted_at),
        notArchived(work_item.archived_at, query),
        liveProject(query),
        sql`${state.state_group} != 'triage'`,
        query.projectId === null ? undefined : eq(work_item.project_id, query.projectId),
      ),
    );
}

type WorkItemHitRow = { id: string; project_id: string; sequence_id: number; name: string; identifier: string; project_name: string; state_name: string };

function workItemHit(row: WorkItemHitRow, score: number): SearchHit {
  return {
    type: "work_item",
    id: row.id,
    project_id: row.project_id,
    key: formatKey(row.identifier, row.sequence_id),
    title: row.name,
    subtitle: `${row.project_name} · ${row.state_name}`,
    score,
  };
}

/** The item whose key the query spells, when it spells one. */
function keyHit(ctx: TesseraContext, query: SearchQuery): SearchHit | null {
  const parsed = parseKey(query.q);
  if (!parsed) return null;
  const row = workItemQuery(
    ctx,
    query,
    and(eq(project.identifier, normalizeIdentifier(parsed.identifier)), eq(work_item.sequence_id, parsed.sequenceId)) ?? sql`1 = 1`,
  ).get();
  return row ? workItemHit(row, KEY_MATCH_SCORE) : null;
}

/** Full-text hits hydrated in relevance order; rows filtered out by the guards keep the others' ranks. */
function workItemHits(ctx: TesseraContext, query: SearchQuery): SearchHit[] {
  const ids = searchWorkItemIds(ctx.sqlite, query.q, { project_id: query.projectId, limit: query.limit });
  if (ids.length === 0) return [];
  const rows = workItemQuery(ctx, query, inArray(work_item.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const hits: SearchHit[] = [];
  ids.forEach((id, rank) => {
    const row = byId.get(id);
    if (row) hits.push(workItemHit(row, Math.max(ftsScore(rank), nameScore(row.name, query) === EXACT_NAME_SCORE ? EXACT_NAME_SCORE : 0)));
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function pageHits(ctx: TesseraContext, query: SearchQuery): SearchHit[] {
  const ids = searchPageIds(ctx.sqlite, query.q, { project_id: query.projectId, limit: query.limit });
  if (ids.length === 0) return [];
  const rows = ctx.db
    .select({ id: page.id, project_id: page.project_id, name: page.name, project_name: project.name })
    .from(page)
    .leftJoin(project, and(eq(page.project_id, project.id), liveProject(query)))
    .where(
      and(
        inArray(page.id, ids),
        isNull(page.deleted_at),
        notArchived(page.archived_at, query),
        // A page of a deleted or archived project is hidden with its project; wiki pages have no project.
        or(isNull(page.project_id), sql`${project.id} IS NOT NULL`),
      ),
    )
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const hits: SearchHit[] = [];
  ids.forEach((id, rank) => {
    const row = byId.get(id);
    if (!row) return;
    hits.push({
      type: "page",
      id: row.id,
      project_id: row.project_id,
      title: row.name,
      subtitle: row.project_name ?? "Wiki",
      score: Math.max(ftsScore(rank), nameScore(row.name, query) === EXACT_NAME_SCORE ? EXACT_NAME_SCORE : 0),
    });
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Cycles, modules, projects (name LIKE)
// ---------------------------------------------------------------------------

function cycleHits(ctx: TesseraContext, query: SearchQuery): SearchHit[] {
  return ctx.db
    .select({ id: cycle.id, project_id: cycle.project_id, name: cycle.name, project_name: project.name })
    .from(cycle)
    .innerJoin(project, eq(cycle.project_id, project.id))
    .where(
      and(
        nameLike(cycle.name, query),
        isNull(cycle.deleted_at),
        notArchived(cycle.archived_at, query),
        liveProject(query),
        // Decision 31: a project with cycles off has no cycle hits.
        eq(project.cycles_enabled, true),
        query.projectId === null ? undefined : eq(cycle.project_id, query.projectId),
      ),
    )
    .orderBy(asc(cycle.name), asc(cycle.created_at))
    .limit(query.limit)
    .all()
    .map((row) => ({
      type: "cycle" as const,
      id: row.id,
      project_id: row.project_id,
      title: row.name,
      subtitle: row.project_name,
      score: nameScore(row.name, query),
    }));
}

function moduleHits(ctx: TesseraContext, query: SearchQuery): SearchHit[] {
  return ctx.db
    .select({ id: moduleTable.id, project_id: moduleTable.project_id, name: moduleTable.name, project_name: project.name })
    .from(moduleTable)
    .innerJoin(project, eq(moduleTable.project_id, project.id))
    .where(
      and(
        nameLike(moduleTable.name, query),
        isNull(moduleTable.deleted_at),
        notArchived(moduleTable.archived_at, query),
        liveProject(query),
        // Decision 31: a project with modules off has no module hits.
        eq(project.modules_enabled, true),
        query.projectId === null ? undefined : eq(moduleTable.project_id, query.projectId),
      ),
    )
    .orderBy(asc(moduleTable.name_key), asc(moduleTable.created_at))
    .limit(query.limit)
    .all()
    .map((row) => ({
      type: "module" as const,
      id: row.id,
      project_id: row.project_id,
      title: row.name,
      subtitle: row.project_name,
      score: nameScore(row.name, query),
    }));
}

/** Views of live projects that have views on, plus workspace views when the search is not scoped to a project. */
function viewHits(ctx: TesseraContext, query: SearchQuery): SearchHit[] {
  return ctx.db
    .select({ id: view.id, project_id: view.project_id, name: view.name, project_name: project.name })
    .from(view)
    .leftJoin(project, eq(view.project_id, project.id))
    .where(
      and(
        nameLike(view.name, query),
        isNull(view.deleted_at),
        query.projectId === null
          ? or(isNull(view.project_id), and(liveProject(query), eq(project.views_enabled, true)))
          : and(eq(view.project_id, query.projectId), liveProject(query), eq(project.views_enabled, true)),
      ),
    )
    .orderBy(asc(view.name_key), asc(view.created_at))
    .limit(query.limit)
    .all()
    .map((row) => ({
      type: "view" as const,
      id: row.id,
      project_id: row.project_id,
      title: row.name,
      subtitle: row.project_name ?? "Workspace",
      score: nameScore(row.name, query),
    }));
}

function projectHits(ctx: TesseraContext, query: SearchQuery): SearchHit[] {
  return ctx.db
    .select({ id: project.id, name: project.name, identifier: project.identifier })
    .from(project)
    .where(
      and(
        or(nameLike(project.name, query), nameLike(project.identifier, query)),
        liveProject(query),
        query.projectId === null ? undefined : eq(project.id, query.projectId),
      ),
    )
    .orderBy(asc(project.name_key), asc(project.created_at))
    .limit(query.limit)
    .all()
    .map((row) => ({
      type: "project" as const,
      id: row.id,
      project_id: row.id,
      key: row.identifier,
      title: row.name,
      subtitle: row.identifier,
      score: Math.max(nameScore(row.name, query), nameKey(row.identifier) === query.key ? EXACT_NAME_SCORE : 0),
    }));
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function typeRank(type: SearchType): number {
  return SEARCH_TYPES.indexOf(type);
}

function compareHits(a: SearchHit, b: SearchHit): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.type !== b.type) return typeRank(a.type) - typeRank(b.type);
  const byTitle = nameKey(a.title).localeCompare(nameKey(b.title));
  return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
}

/** One entry per (type, id), keeping the best score. */
function dedupe(hits: SearchHit[]): SearchHit[] {
  const best = new Map<string, SearchHit>();
  for (const hit of hits) {
    const id = `${hit.type}:${hit.id}`;
    const current = best.get(id);
    if (!current || hit.score > current.score) best.set(id, hit);
  }
  return [...best.values()];
}

/** Ranked hits across the requested kinds; an empty or blank query returns no hits. */
export function searchAll(ctx: TesseraContext, q: string, options: SearchAllOptions = {}): SearchHit[] {
  const data = validateInput(SearchAllInput, { q, ...options });
  const trimmed = data.q.trim();
  if (trimmed === "") return [];
  const query: SearchQuery = {
    q: trimmed,
    key: nameKey(trimmed),
    projectId: data.scope?.project_id ?? null,
    limit: data.limit ?? DEFAULT_SEARCH_LIMIT,
    includeArchived: data.include_archived === true,
  };
  const types = new Set<SearchType>(data.types ?? SEARCH_TYPES);
  const hits: SearchHit[] = [];
  if (types.has("work_item")) {
    const byKey = keyHit(ctx, query);
    if (byKey) hits.push(byKey);
    hits.push(...workItemHits(ctx, query));
  }
  if (types.has("page")) hits.push(...pageHits(ctx, query));
  if (types.has("cycle")) hits.push(...cycleHits(ctx, query));
  if (types.has("module")) hits.push(...moduleHits(ctx, query));
  if (types.has("project")) hits.push(...projectHits(ctx, query));
  if (types.has("view")) hits.push(...viewHits(ctx, query));
  return dedupe(hits).sort(compareHits).slice(0, query.limit);
}
