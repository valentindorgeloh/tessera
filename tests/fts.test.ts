/**
 * Full-text search after all migrations (docs/contracts/schema.md "Migrations
 * and database file": `tests/fts.test.ts` guards that search works after all
 * migrations) and the standalone FTS tables: seeded items are found by stem
 * and by name, `rebuildFts` restores a wiped or dropped index, and no user
 * query can break the MATCH expression.
 */
import type { Database as SqliteDatabase } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { withTx } from "@/lib/tessera/core/tx";
import { openDatabase } from "@/lib/tessera/db/client";
import { rebuildFts, searchPageIds, searchWorkItemIds, upsertWorkItemFts } from "@/lib/tessera/db/fts";
import { REPO_ROOT, migrateIfNeeded, pendingMigrations } from "@/lib/tessera/db/migrate";
import { page } from "@/lib/tessera/db/schema";
import { EXACT_NAME_SCORE, searchAll, type SearchHit } from "@/lib/tessera/search";
import { SEED_SUMMARY, seedDemo } from "@/lib/tessera/seed";
import { createWorkItem, deleteWorkItem, getWorkItem, listWorkItems, updateWorkItem, type WorkItem } from "@/lib/tessera/work-items";
import { createTestDb, withTempFileDb, type DbHandles } from "./helpers/db";

const TODAY = "2026-10-10";

/** Seeded items the tests rely on (names and descriptions from seed.ts). */
const LANDING = "Redesign landing page";
/** The other seeded item whose name holds both "landing" and "page". */
const LANDING_COPY = "Landing page copy review";
const CHECKOUT = "Checkout flow v2";
const TESTIMONIALS = "Testimonials carousel";

const JOURNAL_ENTRIES = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: unknown[] }).entries
  .length;

type Fixture = { handles: DbHandles; ctx: TesseraContext; projectId: string };

function contextFor(handles: DbHandles): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => TODAY });
}

/** Migrated in-memory database with the demo project seeded. */
function seeded(): Fixture {
  const handles = createTestDb();
  const ctx = contextFor(handles);
  const { project } = seedDemo(ctx);
  return { handles, ctx, projectId: project.id };
}

function seededItem(ctx: TesseraContext, projectId: string, name: string): WorkItem {
  const item = listWorkItems(ctx, { scope: { type: "project", project_id: projectId } }).items.find((row) => row.name === name);
  if (!item) throw new Error(`seed has no item named ${name}`);
  return item;
}

function ftsRows(sqlite: SqliteDatabase, table: "work_item_fts" | "page_fts"): number {
  return sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;
}

function workItemIds(hits: SearchHit[]): string[] {
  return hits.filter((hit) => hit.type === "work_item").map((hit) => hit.id);
}

function insertPage(ctx: TesseraContext, projectId: string | null, name: string, body: string): string {
  const now = ctx.now();
  const id = newId();
  ctx.db
    .insert(page)
    .values({
      id,
      project_id: projectId,
      name,
      description_md: body,
      sort_order: firstSortOrder(),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .run();
  return id;
}

// ---------------------------------------------------------------------------
// Search on a migrated database
// ---------------------------------------------------------------------------

describe("search on a migrated database", () => {
  it("finds a seeded item by a word stem in its name", () => {
    const { ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    expect(workItemIds(searchAll(ctx, "redesigning"))).toContain(landing.id);
    expect(workItemIds(searchAll(ctx, "Redesigned"))).toContain(landing.id);
    const testimonials = seededItem(ctx, projectId, TESTIMONIALS);
    expect(workItemIds(searchAll(ctx, "testimonial"))).toContain(testimonials.id);
  });

  it("finds a seeded item by a word in its description", () => {
    const { ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    expect(workItemIds(searchAll(ctx, "faster"))).toEqual([landing.id]);
    const checkout = seededItem(ctx, projectId, CHECKOUT);
    expect(workItemIds(searchAll(ctx, "single-page"))).toContain(checkout.id);
  });

  it("finds a seeded item by its exact name and ranks it first", () => {
    const { ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    const hits = searchAll(ctx, LANDING);
    expect(hits[0].id).toBe(landing.id);
    expect(hits[0].score).toBe(EXACT_NAME_SCORE);
    expect(hits[0].key).toBe(landing.key);
    expect(searchAll(ctx, LANDING.toLowerCase())[0].id).toBe(landing.id);
  });

  it("finds a seeded item by a quoted phrase: quotes are stripped, every word must match", () => {
    const { ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    const copy = seededItem(ctx, projectId, LANDING_COPY);
    expect(workItemIds(searchAll(ctx, '"landing page"')).sort()).toEqual([landing.id, copy.id].sort());
    expect(workItemIds(searchAll(ctx, '"Redesign landing page"'))).toEqual([landing.id]);
    expect(workItemIds(searchAll(ctx, '"landing elephant"'))).toEqual([]);
  });

  it("narrows to the project scope and to the work_item type", () => {
    const { ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    const scoped = searchAll(ctx, "landing", { scope: { project_id: projectId }, types: ["work_item"] });
    expect(scoped.every((hit) => hit.type === "work_item" && hit.project_id === projectId)).toBe(true);
    expect(scoped.map((hit) => hit.id)).toContain(landing.id);
    expect(searchAll(ctx, "landing", { scope: { project_id: newId() } })).toEqual([]);
  });

  it("works on a file database after every migration has been applied", async () => {
    await withTempFileDb(async (migratedPath) => {
      const fresh = path.join(path.dirname(migratedPath), "fresh.db");
      expect(migrateIfNeeded(fresh).applied).toBe(JOURNAL_ENTRIES);
      const handles = openDatabase(fresh);
      try {
        expect(pendingMigrations(handles.sqlite)).toBe(0);
        const ctx = contextFor(handles);
        const { project } = seedDemo(ctx);
        const landing = seededItem(ctx, project.id, LANDING);
        expect(workItemIds(searchAll(ctx, "landing"))).toContain(landing.id);
        expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
      } finally {
        handles.sqlite.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// rebuildFts
// ---------------------------------------------------------------------------

describe("rebuildFts", () => {
  it("after every work_item_fts row is deleted searchAll finds no work items, and rebuildFts restores them", () => {
    const { handles, ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);

    handles.sqlite.exec("DELETE FROM work_item_fts");
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(0);
    expect(searchAll(ctx, "landing", { types: ["work_item"] })).toEqual([]);
    expect(searchAll(ctx, "checkout", { types: ["work_item"] })).toEqual([]);
    // Key lookups go through SQL, not FTS, so they keep working.
    expect(searchAll(ctx, landing.key)[0]?.id).toBe(landing.id);

    const indexed = rebuildFts(handles.sqlite);
    expect(indexed).toEqual({ work_items: SEED_SUMMARY.work_items, pages: 0 });
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
    expect(ftsRows(handles.sqlite, "page_fts")).toBe(0);
    expect(workItemIds(searchAll(ctx, "landing"))).toContain(landing.id);
    expect(workItemIds(searchAll(ctx, "faster"))).toEqual([landing.id]);
  });

  it("recreates both FTS tables when a migration dropped them", () => {
    const { handles, ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    handles.sqlite.exec("DROP TABLE work_item_fts");
    handles.sqlite.exec("DROP TABLE page_fts");
    const indexed = rebuildFts(handles.sqlite);
    expect(indexed.work_items).toBe(SEED_SUMMARY.work_items);
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
    expect(ftsRows(handles.sqlite, "page_fts")).toBe(0);
    expect(workItemIds(searchAll(ctx, "landing"))).toContain(landing.id);
  });

  it("leaves deleted work items and stale rows out and indexes pages", () => {
    const { handles, ctx, projectId } = seeded();
    const doomed = createWorkItem(ctx, { project_id: projectId, name: "Zebra migration notes" });
    deleteWorkItem(ctx, doomed.id);
    upsertWorkItemFts(handles.sqlite, { id: "stale", project_id: projectId, name: "Zebra stale row", body: "" });
    const pageId = insertPage(ctx, projectId, "Release checklist", "Steps before shipping the zebra.");
    expect(searchWorkItemIds(handles.sqlite, "zebra")).toEqual(["stale"]);
    expect(searchPageIds(handles.sqlite, "zebra")).toEqual([]);

    const indexed = rebuildFts(handles.sqlite);
    expect(indexed).toEqual({ work_items: SEED_SUMMARY.work_items, pages: 1 });
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
    expect(ftsRows(handles.sqlite, "page_fts")).toBe(1);
    expect(searchWorkItemIds(handles.sqlite, "zebra")).toEqual([]);
    expect(searchPageIds(handles.sqlite, "zebra")).toEqual([pageId]);
    expect(searchAll(ctx, "zebra").map((hit) => hit.id)).toEqual([pageId]);
  });

  it("is idempotent: a second rebuild returns the same counts and the same hits", () => {
    const { handles, ctx, projectId } = seeded();
    const landing = seededItem(ctx, projectId, LANDING);
    const first = rebuildFts(handles.sqlite);
    const hitsAfterFirst = workItemIds(searchAll(ctx, "landing"));
    const second = rebuildFts(handles.sqlite);
    expect(second).toEqual(first);
    expect(workItemIds(searchAll(ctx, "landing"))).toEqual(hitsAfterFirst);
    expect(hitsAfterFirst).toContain(landing.id);
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
  });
});

// ---------------------------------------------------------------------------
// Hostile queries
// ---------------------------------------------------------------------------

const HOSTILE_QUERIES = [
  'NEAR("landing" AND (page))',
  "landing AND page",
  "(landing) OR page",
  "NOT landing",
  "landing NEAR/2 page",
  "landing NEAR page",
  "landing* ^page",
  '"unterminated',
  'landing" OR "page',
  ")(",
  "((",
  "AND",
  "OR",
  "NOT",
  "NEAR",
  ":",
  "name:landing",
  "{name body}: landing",
  "-landing",
  "+landing",
  "*",
  "landing*",
  "\"\"",
  "' OR 1=1 --",
  "landing; DROP TABLE work_item_fts;",
];

describe("FTS rows follow the transaction", () => {
  it("a work item created inside a transaction that aborts leaves no FTS row behind", () => {
    const { handles, ctx, projectId } = seeded();
    let id = "";
    expect(() =>
      withTx(ctx, () => {
        id = createWorkItem(ctx, { project_id: projectId, name: "Rollback probe" }).id;
        expect(searchWorkItemIds(handles.sqlite, "rollback")).toEqual([id]);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(searchWorkItemIds(handles.sqlite, "rollback")).toEqual([]);
    expect(() => getWorkItem(ctx, id)).toThrow(TrackerError);
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
  });

  it("a rename or delete inside an aborted transaction keeps the previous FTS row", () => {
    const { handles, ctx, projectId } = seeded();
    const item = createWorkItem(ctx, { project_id: projectId, name: "Stable probe" });
    expect(() =>
      withTx(ctx, () => {
        updateWorkItem(ctx, item.id, { name: "Renamed probe" });
        expect(searchWorkItemIds(handles.sqlite, "renamed")).toEqual([item.id]);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(searchWorkItemIds(handles.sqlite, "stable")).toEqual([item.id]);
    expect(searchWorkItemIds(handles.sqlite, "renamed")).toEqual([]);
    expect(() =>
      withTx(ctx, () => {
        deleteWorkItem(ctx, item.id);
        expect(searchWorkItemIds(handles.sqlite, "stable")).toEqual([]);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(searchWorkItemIds(handles.sqlite, "stable")).toEqual([item.id]);
    expect(getWorkItem(ctx, item.id).name).toBe("Stable probe");
  });
});

describe("hostile queries", () => {
  it("a query containing quotes, parentheses and operators like NEAR or AND does not throw", () => {
    const { handles, ctx } = seeded();
    for (const q of HOSTILE_QUERIES) {
      expect(() => searchAll(ctx, q), q).not.toThrow();
      expect(() => searchWorkItemIds(handles.sqlite, q), q).not.toThrow();
      expect(() => searchPageIds(handles.sqlite, q), q).not.toThrow();
    }
    expect(ftsRows(handles.sqlite, "work_item_fts")).toBe(SEED_SUMMARY.work_items);
  });

  it("treats operators as plain words: AND matches items whose text has a word starting with 'and'", () => {
    const { ctx, projectId } = seeded();
    const checkout = seededItem(ctx, projectId, CHECKOUT);
    // "cart, address and payment steps" in the checkout description.
    expect(workItemIds(searchAll(ctx, "AND", { types: ["work_item"] }))).toContain(checkout.id);
    expect(searchAll(ctx, "NEAR", { types: ["work_item"] })).toEqual([]);
  });

  it("parentheses and stray quotes around real words still find the items through the words that match", () => {
    const { ctx, projectId } = seeded();
    const expected = [seededItem(ctx, projectId, LANDING).id, seededItem(ctx, projectId, LANDING_COPY).id].sort();
    expect(workItemIds(searchAll(ctx, "(landing) page")).sort()).toEqual(expected);
    expect(workItemIds(searchAll(ctx, 'landing" page')).sort()).toEqual(expected);
    // "AND" is a required token here, and no landing item contains a word that starts with "and".
    expect(workItemIds(searchAll(ctx, "landing AND page"))).toEqual([]);
  });
});
