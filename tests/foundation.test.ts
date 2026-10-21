import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffFields, latestSeq, logActivity } from "@/lib/tessera/activity";
import {
  ASSISTANT_ACTOR_ID,
  SYSTEM_ACTOR_ID,
  USER_ACTOR_ID,
  ensureSystemActors,
  listActors,
  mcpActorName,
  registerActor,
  touchActor,
  updateActor,
} from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError, fromSqliteError, validateInput } from "@/lib/tessera/core/errors";
import { ORDER_BY_VALUES, parseOrderBy } from "@/lib/tessera/core/group";
import { isId, newId } from "@/lib/tessera/core/ids";
import { formatKey, nameKey, normalizeIdentifier, parseKey } from "@/lib/tessera/core/keys";
import { firstSortOrder, lastSortOrder, sortOrderAfter, sortOrderBefore, sortOrderBetween } from "@/lib/tessera/core/order";
import { addDays, compareDates, daysBetween, isAfter, isBefore, isIsoDate, localDateOf, localDayStart, nowIso, todayLocal } from "@/lib/tessera/core/time";
import { withTx } from "@/lib/tessera/core/tx";
import { MEMORY_DB, openDatabase, resolveDbPath } from "@/lib/tessera/db/client";
import {
  buildMatchExpression,
  deletePageFts,
  deleteWorkItemFts,
  rebuildFts,
  searchPageIds,
  searchWorkItemIds,
  upsertPageFts,
  upsertWorkItemFts,
} from "@/lib/tessera/db/fts";
import { MIGRATIONS_TABLE, REPO_ROOT, backupDir, migrateIfNeeded, pendingMigrations, pruneBackups } from "@/lib/tessera/db/migrate";
import { actor, project, state, sticky, work_item } from "@/lib/tessera/db/schema";
import { DEFAULT_DISPLAY, DisplaySchema, FiltersSchema, RichFiltersSchema } from "@/lib/tessera/schemas";
import { createTestContext, createTestDb, withTempFileDb } from "./helpers/db";
import { withTimeZone } from "./helpers/time-zone";

const JOURNAL_ENTRIES = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: unknown[] })
  .entries.length;

function trackerCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

function tableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
}

function insertSticky(ctx: ReturnType<typeof createTestContext>, name: string, sortOrder: string) {
  const now = ctx.now();
  ctx.db
    .insert(sticky)
    .values({ id: newId(), name, sort_order: sortOrder, created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id })
    .run();
}

function countStickies(ctx: ReturnType<typeof createTestContext>): number {
  return ctx.db.select().from(sticky).all().length;
}

describe("migrations", () => {
  it("apply on :memory: and create every table plus the FTS tables", () => {
    const { sqlite } = createTestDb();
    const names = tableNames(sqlite);
    for (const expected of ["actor", "project", "state", "label", "work_item", "cycle", "module", "view", "activity", "page", "notification", "automation_lease"]) {
      expect(names).toContain(expected);
    }
    expect(names).toContain("work_item_fts");
    expect(names).toContain("page_fts");
    expect(names).toContain(MIGRATIONS_TABLE);
  });

  it("record every journal entry and leave nothing pending", () => {
    const { sqlite } = createTestDb();
    const applied = sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM "${MIGRATIONS_TABLE}"`).get();
    expect(applied?.n).toBe(JOURNAL_ENTRIES);
    expect(JOURNAL_ENTRIES).toBeGreaterThanOrEqual(2);
    expect(pendingMigrations(sqlite)).toBe(0);
  });

  it("apply on a temp file in WAL mode", async () => {
    await withTempFileDb((filePath) => {
      const { sqlite } = openDatabase(filePath);
      const databases = sqlite.pragma("database_list") as { name: string; file: string }[];
      expect(databases.find((d) => d.name === "main")?.file).toBe(filePath);
      expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(pendingMigrations(sqlite)).toBe(0);
      sqlite.close();
    });
  });

  it("are idempotent: opening the same file twice applies nothing new", async () => {
    await withTempFileDb((filePath) => {
      const first = openDatabase(filePath);
      first.sqlite.close();
      const second = openDatabase(filePath);
      const rows = second.sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM "${MIGRATIONS_TABLE}"`).get();
      expect(rows?.n).toBe(JOURNAL_ENTRIES);
      second.sqlite.close();
    });
  });
});

describe("pragmas", () => {
  it("set foreign_keys, synchronous NORMAL and busy_timeout 5000 on :memory:", () => {
    const { sqlite } = createTestDb();
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("synchronous", { simple: true })).toBe(1);
    expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("memory");
  });

  it("enforce foreign keys", () => {
    const ctx = createTestContext(createTestDb());
    const now = ctx.now();
    expect(() =>
      ctx.db
        .insert(state)
        .values({
          id: newId(),
          project_id: "missing-project",
          name: "Todo",
          name_key: "todo",
          state_group: "unstarted",
          sort_order: firstSortOrder(),
          created_at: now,
          updated_at: now,
          created_by: ctx.actor.id,
          updated_by: ctx.actor.id,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("seeded actors", () => {
  it("exist exactly once with the fixed ids", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const rows = listActors(ctx);
    expect(rows.map((r) => r.id).sort()).toEqual([USER_ACTOR_ID, ASSISTANT_ACTOR_ID, SYSTEM_ACTOR_ID].sort());
    expect(rows.find((r) => r.id === USER_ACTOR_ID)?.kind).toBe("user");
    expect(rows.find((r) => r.id === ASSISTANT_ACTOR_ID)?.kind).toBe("assistant");
    expect(rows.find((r) => r.id === SYSTEM_ACTOR_ID)?.kind).toBe("system");
  });

  it("are not duplicated by a second ensureSystemActors call", () => {
    const handles = createTestDb();
    ensureSystemActors(handles.db);
    ensureSystemActors(handles.db);
    expect(handles.db.select().from(actor).all()).toHaveLength(3);
  });

  it("are seeded once per file database across reopens", async () => {
    await withTempFileDb((filePath) => {
      const handles = openDatabase(filePath);
      expect(handles.db.select().from(actor).all()).toHaveLength(3);
      handles.sqlite.close();
    });
  });
});

describe("context", () => {
  it("loads the actor row", () => {
    const ctx = createTestContext(createTestDb(), ASSISTANT_ACTOR_ID);
    expect(ctx.actor.name).toBe("Assistant");
    expect(ctx.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ctx.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("throws NOT_FOUND for an unknown actor", () => {
    const { db, sqlite } = createTestDb();
    expect(() => createContext({ db, sqlite, actorId: newId() })).toThrowError(TrackerError);
    try {
      createContext({ db, sqlite, actorId: "nope" });
    } catch (err) {
      expect((err as TrackerError).code).toBe("NOT_FOUND");
    }
  });
});

describe("withTx", () => {
  it("commits the work of fn", () => {
    const ctx = createTestContext(createTestDb());
    withTx(ctx, () => insertSticky(ctx, "a", firstSortOrder()));
    expect(countStickies(ctx)).toBe(1);
  });

  it("rolls back on throw", () => {
    const ctx = createTestContext(createTestDb());
    expect(() =>
      withTx(ctx, () => {
        insertSticky(ctx, "a", firstSortOrder());
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(countStickies(ctx)).toBe(0);
  });

  it("nests: an inner call joins the open transaction and an outer throw rolls back both", () => {
    const ctx = createTestContext(createTestDb());
    let innerSawTransaction = false;
    expect(() =>
      withTx(ctx, () => {
        insertSticky(ctx, "outer", "a0");
        withTx(ctx, () => {
          innerSawTransaction = ctx.sqlite.inTransaction;
          insertSticky(ctx, "inner", "a1");
        });
        expect(countStickies(ctx)).toBe(2);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(innerSawTransaction).toBe(true);
    expect(countStickies(ctx)).toBe(0);
    expect(ctx.sqlite.inTransaction).toBe(false);
  });

  it("returns the value of fn", () => {
    const ctx = createTestContext(createTestDb());
    expect(withTx(ctx, () => 42)).toBe(42);
  });

  it("maps SQLITE_BUSY to TrackerError BUSY when another connection holds a write lock", async () => {
    await withTempFileDb((filePath) => {
      const handles = openDatabase(filePath);
      handles.sqlite.pragma("busy_timeout = 50");
      const ctx = createTestContext(handles);
      const other = new Database(filePath);
      other.exec("BEGIN IMMEDIATE");
      try {
        let caught: unknown;
        try {
          withTx(ctx, () => insertSticky(ctx, "blocked", firstSortOrder()));
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(TrackerError);
        expect((caught as TrackerError).code).toBe("BUSY");
        expect(ctx.sqlite.inTransaction).toBe(false);
      } finally {
        other.exec("ROLLBACK");
        other.close();
        handles.sqlite.close();
      }
    });
  });
});

describe("errors", () => {
  it("maps UNIQUE violations to CONFLICT", () => {
    const ctx = createTestContext(createTestDb());
    let caught: unknown;
    try {
      withTx(ctx, () => {
        const now = ctx.now();
        ctx.db
          .insert(actor)
          .values({ id: newId(), kind: "agent", name: "you", name_key: "you", created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id })
          .run();
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TrackerError);
    expect((caught as TrackerError).code).toBe("CONFLICT");
  });

  it("maps PRIMARY KEY violations to CONFLICT and passes other errors through", () => {
    const mapped = fromSqliteError(Object.assign(new Error("dup"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" }));
    expect((mapped as TrackerError).code).toBe("CONFLICT");
    const busy = fromSqliteError(Object.assign(new Error("locked"), { code: "SQLITE_BUSY" }));
    expect((busy as TrackerError).code).toBe("BUSY");
    const plain = new Error("other");
    expect(fromSqliteError(plain)).toBe(plain);
    const tracker = new TrackerError("RULE", "x");
    expect(fromSqliteError(tracker)).toBe(tracker);
  });

  it("validateInput throws VALIDATION with the zod issues", () => {
    let caught: unknown;
    try {
      validateInput(DisplaySchema, { layout: "pie" });
    } catch (err) {
      caught = err;
    }
    expect((caught as TrackerError).code).toBe("VALIDATION");
    expect(Array.isArray((caught as TrackerError).details)).toBe(true);
    expect((caught as TrackerError).message).toContain("layout");
  });
});

describe("sort order helpers", () => {
  it("produce lexicographically ordered keys", () => {
    const first = firstSortOrder();
    const after = sortOrderAfter(first);
    const before = sortOrderBefore(first);
    const between = sortOrderBetween(first, after);
    expect(before < first).toBe(true);
    expect(first < between).toBe(true);
    expect(between < after).toBe(true);
    expect(sortOrderAfter(null)).toBe(first);
    expect(sortOrderBefore(null)).toBe(first);
    expect(sortOrderBetween(null, null)).toBe(first);
  });

  it("refuse an impossible gap with VALIDATION instead of a raw library error", () => {
    expect(trackerCode(() => sortOrderBetween("a1", "a1"))).toBe("VALIDATION");
    let details: unknown;
    try {
      sortOrderBetween("a1", "a1");
    } catch (err) {
      details = err instanceof TrackerError ? err.details : undefined;
    }
    expect(details).toEqual({ before: "a1", after: "a1" });
  });

  it("lastSortOrder returns the max key or null", () => {
    const ctx = createTestContext(createTestDb());
    expect(lastSortOrder(ctx.db, sticky)).toBeNull();
    const a = firstSortOrder();
    const b = sortOrderAfter(a);
    insertSticky(ctx, "b", b);
    insertSticky(ctx, "a", a);
    expect(lastSortOrder(ctx.db, sticky)).toBe(b);
    expect(lastSortOrder(ctx.db, sticky, sql`${sticky.name} = 'a'`)).toBe(a);
  });
});

describe("keys", () => {
  it("formats and parses WEB-12", () => {
    expect(formatKey("WEB", 12)).toBe("WEB-12");
    expect(parseKey("WEB-12")).toEqual({ identifier: "WEB", sequenceId: 12 });
    expect(parseKey(" web-7 ")).toEqual({ identifier: "WEB", sequenceId: 7 });
  });

  it("rejects strings that are not keys", () => {
    expect(parseKey("WEB")).toBeNull();
    expect(parseKey("WEB-")).toBeNull();
    expect(parseKey("1AB-2")).toBeNull();
    expect(parseKey("")).toBeNull();
    expect(parseKey("ABCDEFGHIJKLM-1")).toBeNull();
  });

  it("normalizes identifiers and name keys", () => {
    expect(normalizeIdentifier("  web ")).toBe("WEB");
    expect(nameKey("  Hello   World ")).toBe("hello world");
    expect(nameKey("In\tProgress")).toBe("in progress");
  });

  it("ids are v7 uuids", () => {
    const id = newId();
    expect(isId(id)).toBe(true);
    expect(id.charAt(14)).toBe("7");
    expect(isId(USER_ACTOR_ID)).toBe(true);
    expect(isId("nope")).toBe(false);
  });
});

describe("time", () => {
  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-01-01")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
  });

  it("compares dates", () => {
    expect(compareDates("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareDates("2026-01-02", "2026-01-02")).toBe(0);
    expect(isBefore("2026-01-01", "2026-01-02")).toBe(true);
    expect(isAfter("2026-01-01", "2026-01-02")).toBe(false);
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nowIso().endsWith("Z")).toBe(true);
  });

  it("localDateOf and localDayStart follow the process time zone", () => {
    withTimeZone("UTC", () => {
      expect(localDateOf("2026-10-10T23:30:00.000Z")).toBe("2026-10-10");
      expect(localDayStart("2026-10-11")).toBe("2026-10-11T00:00:00.000Z");
    });
    withTimeZone("Asia/Tokyo", () => {
      expect(localDateOf("2026-10-10T23:30:00.000Z")).toBe("2026-10-11");
      expect(localDayStart("2026-10-11")).toBe("2026-10-10T15:00:00.000Z");
    });
    withTimeZone("America/Los_Angeles", () => {
      expect(localDateOf("2026-10-11T03:00:00.000Z")).toBe("2026-10-10");
      expect(localDayStart("2026-10-11")).toBe("2026-10-11T07:00:00.000Z");
    });
  });
});

describe("group and display vocabulary", () => {
  it("order_by values cover both directions", () => {
    expect(ORDER_BY_VALUES).toContain("sort_order");
    expect(ORDER_BY_VALUES).toContain("-created_at");
    expect(parseOrderBy("-target_date")).toEqual({ field: "target_date", direction: "desc" });
    expect(parseOrderBy("name")).toEqual({ field: "name", direction: "asc" });
  });

  it("DisplaySchema fills defaults and matches DEFAULT_DISPLAY", () => {
    expect(DisplaySchema.parse({})).toEqual(DEFAULT_DISPLAY);
    expect(DEFAULT_DISPLAY.layout).toBe("list");
    expect(DEFAULT_DISPLAY.order_by).toBe("sort_order");
    expect(DEFAULT_DISPLAY.properties.key).toBe(true);
    const custom = DisplaySchema.parse({ layout: "board", group_by: "state", properties: { labels: false } });
    expect(custom.group_by).toBe("state");
    expect(custom.properties.labels).toBe(false);
    expect(custom.properties.state).toBe(true);
  });

  it("FiltersSchema and RichFiltersSchema parse nested trees", () => {
    expect(FiltersSchema.parse({ state_group: ["started"], target_date: { op: "before", relative: "1w" } }).state_group).toEqual(["started"]);
    expect(() => FiltersSchema.parse({ priority: ["critical"] })).toThrow();
    const tree = RichFiltersSchema.parse({
      and: [{ field: "priority", op: "in", value: ["urgent", "high"] }, { not: { or: [{ field: "state_group", op: "eq", value: "completed" }] } }],
    });
    expect("and" in tree).toBe(true);
    expect(() => RichFiltersSchema.parse({ field: "priority", op: "like", value: "x" })).toThrow();
  });
});

describe("full-text search", () => {
  it("finds work items by stem and ranks them", () => {
    const { sqlite } = createTestDb();
    upsertWorkItemFts(sqlite, { id: "a", project_id: "p1", name: "Running the tests", body: "" });
    upsertWorkItemFts(sqlite, { id: "b", project_id: "p1", name: "Design review", body: "the runner ran quickly" });
    upsertWorkItemFts(sqlite, { id: "c", project_id: "p2", name: "Runs on Windows", body: "" });
    const hits = searchWorkItemIds(sqlite, "run");
    expect(hits).toContain("a");
    expect(hits).toContain("b");
    expect(hits).toContain("c");
    expect(searchWorkItemIds(sqlite, "run", { project_id: "p1" }).sort()).toEqual(["a", "b"]);
    expect(searchWorkItemIds(sqlite, "run", { limit: 1 })).toHaveLength(1);
    expect(searchWorkItemIds(sqlite, "design")).toEqual(["b"]);
  });

  it("upsert replaces the previous row and delete removes it", () => {
    const { sqlite } = createTestDb();
    upsertWorkItemFts(sqlite, { id: "a", project_id: "p1", name: "Alpha", body: null });
    upsertWorkItemFts(sqlite, { id: "a", project_id: "p1", name: "Beta", body: null });
    expect(searchWorkItemIds(sqlite, "alpha")).toEqual([]);
    expect(searchWorkItemIds(sqlite, "beta")).toEqual(["a"]);
    deleteWorkItemFts(sqlite, "a");
    expect(searchWorkItemIds(sqlite, "beta")).toEqual([]);
  });

  it("indexes pages separately and ignores diacritics", () => {
    const { sqlite } = createTestDb();
    upsertPageFts(sqlite, { id: "pg", project_id: null, name: "Café guidelines", body: "Handbuch" });
    expect(searchPageIds(sqlite, "cafe")).toEqual(["pg"]);
    expect(searchWorkItemIds(sqlite, "cafe")).toEqual([]);
    deletePageFts(sqlite, "pg");
    expect(searchPageIds(sqlite, "cafe")).toEqual([]);
  });

  it("never lets user input break the MATCH query", () => {
    const { sqlite } = createTestDb();
    upsertWorkItemFts(sqlite, { id: "a", project_id: "p1", name: "Quote test", body: "" });
    expect(buildMatchExpression('  "quote" OR (test) NOT * ')).toBe('"quote"* "OR"* "(test)"* "NOT"* "*"*');
    expect(buildMatchExpression("   ")).toBeNull();
    expect(searchWorkItemIds(sqlite, "")).toEqual([]);
    expect(() => searchWorkItemIds(sqlite, 'quote" OR (')).not.toThrow();
    expect(() => searchWorkItemIds(sqlite, "AND OR NOT ^ * -")).not.toThrow();
    expect(searchWorkItemIds(sqlite, "quote test")).toEqual(["a"]);
  });

  it("rebuild re-reads the work_item and page tables", () => {
    const ctx = createTestContext(createTestDb());
    const now = ctx.now();
    const projectId = newId();
    const stateId = newId();
    const itemId = newId();
    withTx(ctx, () => {
      ctx.db
        .insert(project)
        .values({ id: projectId, name: "Web", name_key: "web", identifier: "WEB", sort_order: firstSortOrder(), created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id })
        .run();
      ctx.db
        .insert(state)
        .values({ id: stateId, project_id: projectId, name: "Todo", name_key: "todo", state_group: "unstarted", sort_order: firstSortOrder(), created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id })
        .run();
      ctx.db
        .insert(work_item)
        .values({ id: itemId, project_id: projectId, sequence_id: 1, name: "Searchable widget", description_md: "Indexed body", state_id: stateId, sort_order: firstSortOrder(), created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id })
        .run();
      upsertWorkItemFts(ctx.sqlite, { id: "stale", project_id: projectId, name: "stale row", body: "" });
    });
    const counts = rebuildFts(ctx.sqlite);
    expect(counts).toEqual({ work_items: 1, pages: 0 });
    expect(searchWorkItemIds(ctx.sqlite, "stale")).toEqual([]);
    expect(searchWorkItemIds(ctx.sqlite, "widget")).toEqual([itemId]);
    expect(searchWorkItemIds(ctx.sqlite, "indexed")).toEqual([itemId]);
  });
});

describe("activity", () => {
  it("latestSeq starts at 0 and increases with every row", () => {
    const ctx = createTestContext(createTestDb());
    expect(latestSeq(ctx)).toBe(0);
    expect(latestSeq(ctx.sqlite)).toBe(0);
    withTx(ctx, () => logActivity(ctx, { entity_type: "sticky", entity_id: "s1", verb: "created" }));
    expect(latestSeq(ctx)).toBe(1);
    withTx(ctx, () => logActivity(ctx, { entity_type: "sticky", entity_id: "s1", verb: "updated", field: "name" }));
    expect(latestSeq(ctx)).toBe(2);
  });

  it("logActivity refuses to run outside a transaction and stamps the actor", () => {
    const ctx = createTestContext(createTestDb(), SYSTEM_ACTOR_ID);
    expect(() => logActivity(ctx, { entity_type: "sticky", entity_id: "s1", verb: "created" })).toThrow(/withTx/);
    const row = withTx(ctx, () => logActivity(ctx, { entity_type: "sticky", entity_id: "s1", verb: "created" }));
    expect(row.actor_id).toBe(SYSTEM_ACTOR_ID);
    expect(row.uid).toMatch(/-7/);
    expect(row.seq).toBe(1);
  });

  it("diffFields writes one row per changed field with resolved identifiers", () => {
    const ctx = createTestContext(createTestDb());
    const before = { name: "Old", priority: "none", state_id: "s1", count: 1 };
    const after = { name: "New", priority: "none", state_id: "s2", count: 2 };
    const rows = withTx(ctx, () =>
      diffFields(ctx, { entity_type: "sticky", entity_id: "w1" }, before, after, ["name", "priority", "state_id", "count"], (field, value) =>
        field === "state_id" ? `State ${String(value)}` : null,
      ),
    );
    expect(rows.map((r) => r.field)).toEqual(["name", "state_id", "count"]);
    expect(rows[1].old_identifier).toBe("State s1");
    expect(rows[1].new_identifier).toBe("State s2");
    expect(rows[2].old_value).toBe("1");
    expect(rows[2].new_value).toBe("2");
    expect(rows.every((r) => r.verb === "updated" && r.entity_id === "w1" && r.work_item_id === null)).toBe(true);
    expect(latestSeq(ctx)).toBe(3);
  });
});

describe("actors", () => {
  it("registerActor is idempotent on name_key and follows the mcp:<client> convention", () => {
    const ctx = createTestContext(createTestDb());
    const name = mcpActorName("Claude Code");
    expect(name).toBe("mcp:Claude Code");
    const first = registerActor(ctx, { kind: "agent", name, client_name: "Claude Code 1.0" });
    const second = registerActor(ctx, { kind: "agent", name: "MCP:claude   code" });
    expect(second.id).toBe(first.id);
    expect(second.client_name).toBe("Claude Code 1.0");
    expect(listActors(ctx)).toHaveLength(4);
    expect(latestSeq(ctx)).toBe(1);
  });

  it("registerActor validates its input", () => {
    const ctx = createTestContext(createTestDb());
    expect(() => registerActor(ctx, { kind: "user" as "agent", name: "x" })).toThrowError(TrackerError);
    expect(() => registerActor(ctx, { kind: "agent", name: "  " })).toThrowError(TrackerError);
  });

  it("touchActor moves last_seen_at and updateActor logs activity", () => {
    const ctx = createTestContext(createTestDb());
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:bot" });
    const touched = createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId: USER_ACTOR_ID, now: () => "2030-01-01T00:00:00.000Z" });
    touchActor(touched, agent.id);
    expect(listActors(ctx).find((a) => a.id === agent.id)?.last_seen_at).toBe("2030-01-01T00:00:00.000Z");
    expect(() => touchActor(ctx, newId())).toThrowError(TrackerError);
    const updated = updateActor(ctx, agent.id, { name: "mcp:robot", color: "pink" });
    expect(updated.name).toBe("mcp:robot");
    expect(updated.name_key).toBe("mcp:robot");
    expect(updated.color).toBe("pink");
    expect(latestSeq(ctx)).toBe(3);
  });
});

describe("migrateIfNeeded", () => {
  it("creates a backup when a file database has pending migrations and prunes to the newest 10", async () => {
    await withTempFileDb((filePath) => {
      const probe = new Database(filePath);
      // The migrator's `id SERIAL` column is NULL in SQLite, so the newest row is found by created_at.
      probe.prepare(`DELETE FROM "${MIGRATIONS_TABLE}" WHERE created_at = (SELECT max(created_at) FROM "${MIGRATIONS_TABLE}")`).run();
      // 0011 adds the two live-row indexes of the workspace list; drop them so the newest migration can re-apply.
      probe.exec(`DROP INDEX IF EXISTS work_item_live_sort_idx; DROP INDEX IF EXISTS work_item_live_state_idx;`);
      expect(pendingMigrations(probe)).toBe(1);
      probe.close();

      const dir = backupDir(filePath);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 12; i += 1) {
        fs.writeFileSync(path.join(dir, `tessera-2000-01-01T00-00-${String(i).padStart(2, "0")}.000Z.db`), "");
      }

      const result = migrateIfNeeded(filePath);
      expect(result.applied).toBe(1);
      expect(result.backup).not.toBeNull();
      expect(fs.existsSync(result.backup as string)).toBe(true);
      expect(path.dirname(result.backup as string)).toBe(dir);
      expect(fs.readdirSync(dir).filter((n) => n.startsWith("tessera-"))).toHaveLength(10);
      expect(result.pruned.length).toBe(3);
      expect(fs.existsSync(`${filePath}.migrate.lock`)).toBe(false);

      const check = new Database(filePath);
      expect(pendingMigrations(check)).toBe(0);
      expect(tableNames(check)).toContain("page_fts");
      check.close();

      const again = migrateIfNeeded(filePath);
      expect(again).toEqual({ applied: 0, backup: null, pruned: [] });
    });
  });

  it("gives up with BUSY when another process holds the migration lock and touches nothing", async () => {
    await withTempFileDb((filePath) => {
      const fresh = path.join(path.dirname(filePath), "locked.db");
      const lockPath = `${fresh}.migrate.lock`;
      fs.closeSync(fs.openSync(lockPath, "wx"));
      const started = Date.now();
      expect(trackerCode(() => migrateIfNeeded(fresh, { lockTimeoutMs: 300 }))).toBe("BUSY");
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(fs.existsSync(fresh)).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);
    });
  });

  it("waits for the lock holder to finish, then migrates and removes the lock", async () => {
    await withTempFileDb(async (filePath) => {
      const fresh = path.join(path.dirname(filePath), "waited.db");
      const lockPath = `${fresh}.migrate.lock`;
      fs.closeSync(fs.openSync(lockPath, "wx"));
      // A separate process releases the lock after 400ms while this one blocks in acquireLock.
      const holder = spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').rmSync(process.argv[1], { force: true }), 400)", lockPath], {
        stdio: "ignore",
      });
      const exited = new Promise<void>((resolve) => holder.on("exit", () => resolve()));
      const started = Date.now();
      const result = migrateIfNeeded(fresh, { lockTimeoutMs: 10_000 });
      await exited;
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(result.applied).toBe(JOURNAL_ENTRIES);
      expect(fs.existsSync(lockPath)).toBe(false);
      const check = new Database(fresh);
      expect(pendingMigrations(check)).toBe(0);
      check.close();
    });
  });

  it("migrates a brand-new file without a backup", async () => {
    await withTempFileDb((filePath) => {
      const fresh = path.join(path.dirname(filePath), "fresh.db");
      const result = migrateIfNeeded(fresh);
      expect(result.applied).toBe(JOURNAL_ENTRIES);
      expect(result.backup).toBeNull();
      expect(fs.existsSync(fresh)).toBe(true);
    });
  });

  it("pruneBackups keeps the newest files by name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-backups-"));
    try {
      for (const stamp of ["2026-01-01T00-00-00.000Z", "2026-01-03T00-00-00.000Z", "2026-01-02T00-00-00.000Z"]) {
        fs.writeFileSync(path.join(dir, `tessera-${stamp}.db`), "");
      }
      fs.writeFileSync(path.join(dir, "unrelated.txt"), "");
      const removed = pruneBackups(dir, 2);
      expect(removed.map((p) => path.basename(p))).toEqual(["tessera-2026-01-01T00-00-00.000Z.db"]);
      expect(fs.readdirSync(dir).sort()).toEqual(["tessera-2026-01-02T00-00-00.000Z.db", "tessera-2026-01-03T00-00-00.000Z.db", "unrelated.txt"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveDbPath", () => {
  it("resolves relative paths against the repo root and passes :memory: through", () => {
    expect(resolveDbPath("data/x.db")).toBe(path.join(REPO_ROOT, "data", "x.db"));
    expect(resolveDbPath("/tmp/abs.db")).toBe("/tmp/abs.db");
    expect(resolveDbPath(MEMORY_DB)).toBe(MEMORY_DB);
    expect(fs.existsSync(path.join(REPO_ROOT, "package.json"))).toBe(true);
  });
});
