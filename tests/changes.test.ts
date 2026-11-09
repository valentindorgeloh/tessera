import { describe, expect, it } from "vitest";
import { latestSeq as activityLatestSeq } from "@/lib/tessera/activity";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { collapseDescriptionEdits, DESCRIPTION_COLLAPSE_WINDOW_MS, latestSeq, listActivity, listChanges } from "@/lib/tessera/changes";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { createProject, type Project } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import type { ActivityRow, StateRow } from "@/lib/tessera/types";
import { createWorkItem, getWorkItem, updateWorkItem, updateWorkItemDescription, type WorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "./helpers/db";

type Clock = { now: string };

type Fixture = { handles: DbHandles; clock: Clock; ctx: TesseraContext; assistant: TesseraContext; project: Project; states: Record<string, StateRow> };

/** Both actors share one movable clock so created_at gaps are under the test's control. */
function setup(): Fixture {
  const handles = createTestDb();
  const clock: Clock = { now: "2026-10-10T10:00:00.000Z" };
  const make = (actorId: string) => createContext({ db: handles.db, sqlite: handles.sqlite, actorId, now: () => clock.now, today: () => "2026-10-10" });
  const ctx = make(USER_ACTOR_ID);
  const assistant = make(ASSISTANT_ACTOR_ID);
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.state_group, s]));
  return { handles, clock, ctx, assistant, project: p, states };
}

function advance(clock: Clock, ms: number): void {
  clock.now = new Date(new Date(clock.now).getTime() + ms).toISOString();
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

/** Writes `bodies` as successive description versions starting from the item's current version. */
function editDescription(ctx: TesseraContext, item: WorkItem, bodies: string[], clock?: Clock, gapMs = 0): void {
  let version = getWorkItem(ctx, item.id).description_version;
  for (const body of bodies) {
    if (clock && gapMs > 0) advance(clock, gapMs);
    updateWorkItemDescription(ctx, item.id, { description_md: body, expected_description_version: version });
    version += 1;
  }
}

describe("listChanges", () => {
  it("returns every row after the cursor, oldest first, and a cursor at the latest seq", () => {
    const { ctx, project } = setup();
    const before = listChanges(ctx, 0);
    expect(before.changes.length).toBeGreaterThan(0);
    expect(before.cursor).toBe(latestSeq(ctx));
    const seqs = before.changes.map((change) => change.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const item = createWorkItem(ctx, { project_id: project.id, name: "A" });
    const after = listChanges(ctx, before.cursor);
    expect(after.changes.every((change) => change.seq > before.cursor)).toBe(true);
    expect(after.changes.some((change) => change.entity_id === item.id && change.verb === "created")).toBe(true);
    expect(after.cursor).toBe(latestSeq(ctx));
  });

  it("is monotonic: the cursor never moves backwards, even past the end of the log", () => {
    const { ctx, project } = setup();
    let cursor = 0;
    for (let i = 0; i < 3; i += 1) {
      createWorkItem(ctx, { project_id: project.id, name: `Item ${i}` });
      const result = listChanges(ctx, cursor);
      expect(result.cursor).toBeGreaterThanOrEqual(cursor);
      cursor = result.cursor;
    }
    const idle = listChanges(ctx, cursor);
    expect(idle.changes).toEqual([]);
    expect(idle.cursor).toBe(cursor);
    const beyond = listChanges(ctx, cursor + 100);
    expect(beyond.changes).toEqual([]);
    expect(beyond.cursor).toBe(cursor + 100);
  });

  it("returns only the cursor fields of a change", () => {
    const { ctx, project } = setup();
    const since = latestSeq(ctx);
    const item = createWorkItem(ctx, { project_id: project.id, name: "Shape" });
    const [change] = listChanges(ctx, since).changes;
    expect(change).toEqual({
      seq: since + 1,
      entity_type: "work_item",
      entity_id: item.id,
      work_item_id: item.id,
      project_id: project.id,
      verb: "created",
      field: null,
      actor_id: USER_ACTOR_ID,
      created_at: ctx.now(),
    });
  });

  it("excludes the given actors but still moves the cursor past their rows", () => {
    const { ctx, assistant, project } = setup();
    const since = latestSeq(ctx);
    createWorkItem(ctx, { project_id: project.id, name: "By user" });
    const theirs = createWorkItem(assistant, { project_id: project.id, name: "By assistant" });
    const onlyExternal = listChanges(ctx, since, { excludeActors: [USER_ACTOR_ID] });
    expect(onlyExternal.changes.length).toBeGreaterThan(0);
    expect(onlyExternal.changes.every((change) => change.actor_id === ASSISTANT_ACTOR_ID)).toBe(true);
    expect(onlyExternal.changes.some((change) => change.entity_id === theirs.id)).toBe(true);
    expect(onlyExternal.cursor).toBe(latestSeq(ctx));
    const nobody = listChanges(ctx, since, { excludeActors: [USER_ACTOR_ID, ASSISTANT_ACTOR_ID] });
    expect(nobody.changes).toEqual([]);
    expect(nobody.cursor).toBe(latestSeq(ctx));
  });

  it("cuts the page at limit and points the cursor at the last returned row so paging continues without gaps", () => {
    const { ctx, project } = setup();
    const since = latestSeq(ctx);
    for (let i = 0; i < 5; i += 1) createWorkItem(ctx, { project_id: project.id, name: `Item ${i}` });
    const all = listChanges(ctx, since).changes;
    expect(all.length).toBeGreaterThan(4);
    const pages: number[] = [];
    let cursor = since;
    for (;;) {
      const result = listChanges(ctx, cursor, { limit: 2 });
      expect(result.changes.length).toBeLessThanOrEqual(2);
      pages.push(...result.changes.map((change) => change.seq));
      if (result.changes.length === 2 && result.cursor === result.changes[1].seq && result.cursor < latestSeq(ctx)) {
        cursor = result.cursor;
        continue;
      }
      expect(result.cursor).toBe(latestSeq(ctx));
      break;
    }
    expect(pages).toEqual(all.map((change) => change.seq));
  });

  it("an exactly full page is not treated as cut", () => {
    const { ctx, project } = setup();
    const since = latestSeq(ctx);
    createWorkItem(ctx, { project_id: project.id, name: "One" });
    const n = latestSeq(ctx) - since;
    const result = listChanges(ctx, since, { limit: n });
    expect(result.changes).toHaveLength(n);
    expect(result.cursor).toBe(latestSeq(ctx));
  });

  it("VALIDATION for a negative cursor or a bad limit", () => {
    const { ctx } = setup();
    expect(errorCode(() => listChanges(ctx, -1))).toBe("VALIDATION");
    expect(errorCode(() => listChanges(ctx, 0, { limit: 0 }))).toBe("VALIDATION");
    expect(errorCode(() => listChanges(ctx, 1.5))).toBe("VALIDATION");
  });

  it("returns latest_seq, the newest seq in the log, next to the cursor (decision 145)", () => {
    const { ctx, project } = setup();
    expect(listChanges(ctx, 0).latest_seq).toBe(latestSeq(ctx));
    const since = latestSeq(ctx);
    createWorkItem(ctx, { project_id: project.id, name: "A" });
    createWorkItem(ctx, { project_id: project.id, name: "B" });
    const result = listChanges(ctx, since);
    expect(result.latest_seq).toBe(latestSeq(ctx));
    expect(result.latest_seq).toBe(result.cursor);
    // A caught-up poller sees its own cursor.
    expect(listChanges(ctx, result.cursor).latest_seq).toBe(result.cursor);
  });

  it("keeps the real latest_seq when excluded actors hide every row", () => {
    const { ctx, assistant, project } = setup();
    const since = latestSeq(ctx);
    createWorkItem(assistant, { project_id: project.id, name: "By assistant" });
    const result = listChanges(ctx, since, { excludeActors: [ASSISTANT_ACTOR_ID] });
    expect(result.changes).toEqual([]);
    expect(result.latest_seq).toBe(latestSeq(ctx));
    expect(result.latest_seq).toBeGreaterThan(since);
  });

  it("a cut page keeps the cursor at its last row and still reports the real latest_seq", () => {
    const { ctx, project } = setup();
    const since = latestSeq(ctx);
    for (let i = 0; i < 4; i += 1) createWorkItem(ctx, { project_id: project.id, name: `Item ${i}` });
    const page = listChanges(ctx, since, { limit: 2 });
    expect(page.changes).toHaveLength(2);
    expect(page.cursor).toBe(page.changes[1].seq);
    expect(page.cursor).toBeLessThan(latestSeq(ctx));
    expect(page.latest_seq).toBe(latestSeq(ctx));
  });

  it("after a rewind latest_seq falls below since_seq while the cursor stays at since_seq", () => {
    const { ctx, handles, project } = setup();
    for (let i = 0; i < 3; i += 1) createWorkItem(ctx, { project_id: project.id, name: `Item ${i}` });
    const polled = listChanges(ctx, 0);
    expect(polled.cursor).toBe(latestSeq(ctx));
    // A restore from a backup brings back a log that ends earlier than the poller's cursor.
    const kept = polled.cursor - 2;
    handles.sqlite.prepare("DELETE FROM activity WHERE seq > ?").run(kept);
    const rewound = listChanges(ctx, polled.cursor);
    expect(rewound.latest_seq).toBe(kept);
    expect(rewound.latest_seq).toBeLessThan(polled.cursor);
    expect(rewound.changes).toEqual([]);
    expect(rewound.cursor).toBe(polled.cursor);
  });

  it("re-exports latestSeq from activity.ts", () => {
    const { ctx } = setup();
    expect(latestSeq).toBe(activityLatestSeq);
    expect(latestSeq(ctx)).toBe(activityLatestSeq(ctx.sqlite));
  });
});

describe("listActivity", () => {
  it("collapses consecutive description edits by one actor within five minutes into one entry", () => {
    const { ctx, clock, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc" });
    const since = latestSeq(ctx);
    editDescription(ctx, item, ["first", "second", "third"], clock, 60_000);
    const entries = listActivity(ctx, { work_item_id: item.id, since_seq: since });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.field).toBe("description_md");
    expect(entry.old_value).toBe("0");
    expect(entry.new_value).toBe("3");
    expect(entry.merged_count).toBe(3);
    expect(entry.seq).toBe(since + 1);
    expect(entry.last_seq).toBe(since + 3);
    expect(entry.actor_name).toBe("You");
    expect(entry.actor_id).toBe(USER_ACTOR_ID);
  });

  it("starts a new entry when the gap to the last edit exceeds five minutes", () => {
    const { ctx, clock, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc" });
    const since = latestSeq(ctx);
    editDescription(ctx, item, ["a", "b"], clock, 60_000);
    advance(clock, DESCRIPTION_COLLAPSE_WINDOW_MS + 1);
    editDescription(ctx, item, ["c"]);
    const entries = listActivity(ctx, { work_item_id: item.id, since_seq: since });
    expect(entries.map((entry) => [entry.old_value, entry.new_value, entry.merged_count])).toEqual([
      ["0", "2", 2],
      ["2", "3", 1],
    ]);
  });

  it("keeps edits exactly five minutes apart together and measures from the last merged row", () => {
    const { ctx, clock, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc" });
    const since = latestSeq(ctx);
    editDescription(ctx, item, ["a", "b", "c", "d"], clock, DESCRIPTION_COLLAPSE_WINDOW_MS);
    expect(listActivity(ctx, { work_item_id: item.id, since_seq: since })).toHaveLength(1);
  });

  it("does not collapse edits by different actors", () => {
    const { ctx, assistant, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc" });
    const since = latestSeq(ctx);
    editDescription(ctx, item, ["a"]);
    editDescription(assistant, item, ["b"]);
    editDescription(ctx, item, ["c"]);
    const entries = listActivity(ctx, { work_item_id: item.id, since_seq: since });
    expect(entries.map((entry) => entry.actor_name)).toEqual(["You", "Assistant", "You"]);
    expect(entries.every((entry) => entry.merged_count === 1)).toBe(true);
  });

  it("does not collapse across another change in between", () => {
    const { ctx, project, states } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc" });
    const since = latestSeq(ctx);
    editDescription(ctx, item, ["a"]);
    updateWorkItem(ctx, item.id, { state_id: states.unstarted.id });
    editDescription(ctx, item, ["b"]);
    const entries = listActivity(ctx, { work_item_id: item.id, since_seq: since });
    expect(entries.map((entry) => entry.field)).toEqual(["description_md", "state_id", "description_md"]);
  });

  it("does not collapse description edits of different items in a project feed", () => {
    const { ctx, project } = setup();
    const a = createWorkItem(ctx, { project_id: project.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: project.id, name: "B" });
    const since = latestSeq(ctx);
    editDescription(ctx, a, ["a1"]);
    editDescription(ctx, b, ["b1"]);
    editDescription(ctx, b, ["b2"]);
    const entries = listActivity(ctx, { project_id: project.id, since_seq: since });
    expect(entries.map((entry) => [entry.entity_id, entry.merged_count])).toEqual([
      [a.id, 1],
      [b.id, 2],
    ]);
  });

  it("returns the project feed including rows of every item, oldest first, honouring since_seq", () => {
    const { ctx, project } = setup();
    const since = latestSeq(ctx);
    const a = createWorkItem(ctx, { project_id: project.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: project.id, name: "B" });
    const entries = listActivity(ctx, { project_id: project.id, since_seq: since });
    expect(entries.map((entry) => entry.entity_id)).toEqual([a.id, b.id]);
    expect(entries.every((entry) => entry.project_id === project.id)).toBe(true);
    const full = listActivity(ctx, { project_id: project.id });
    expect(full[0].entity_type).toBe("project");
    expect(full.length).toBeGreaterThan(entries.length);
  });

  it("limit keeps the newest raw rows and still returns them oldest first", () => {
    const { ctx, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc" });
    updateWorkItem(ctx, item.id, { priority: "high" });
    updateWorkItem(ctx, item.id, { priority: "low" });
    updateWorkItem(ctx, item.id, { name: "Renamed" });
    const entries = listActivity(ctx, { work_item_id: item.id, limit: 2 });
    expect(entries.map((entry) => [entry.field, entry.new_value])).toEqual([
      ["priority", "low"],
      ["name", "Renamed"],
    ]);
    expect(entries[0].seq).toBeLessThan(entries[1].seq);
  });

  it("includes membership rows logged on the item", () => {
    const { ctx, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "Doc", assignee_ids: [ASSISTANT_ACTOR_ID] });
    const fields = listActivity(ctx, { work_item_id: item.id }).map((entry) => entry.verb);
    expect(fields).toContain("created");
    expect(listActivity(ctx, { work_item_id: item.id }).every((entry) => entry.work_item_id === item.id)).toBe(true);
  });

  it("NOT_FOUND for an unknown item or project and VALIDATION without exactly one scope", () => {
    const { ctx, project } = setup();
    expect(errorCode(() => listActivity(ctx, { work_item_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => listActivity(ctx, { project_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => listActivity(ctx, {}))).toBe("VALIDATION");
    expect(errorCode(() => listActivity(ctx, { project_id: project.id, work_item_id: newId() }))).toBe("VALIDATION");
    expect(errorCode(() => listActivity(ctx, { project_id: project.id, limit: 0 }))).toBe("VALIDATION");
  });
});

describe("collapseDescriptionEdits", () => {
  function row(seq: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
    return {
      seq,
      uid: `uid-${seq}`,
      project_id: "p",
      entity_type: "work_item",
      entity_id: "w",
      work_item_id: "w",
      verb: "updated",
      field: "description_md",
      old_value: String(seq - 1),
      new_value: String(seq),
      old_identifier: null,
      new_identifier: null,
      comment: null,
      actor_id: "a",
      created_at: "2026-10-10T10:00:00.000Z",
      ...overrides,
    };
  }

  it("keeps the first row's seq, created_at and old_value and the last row's new_value", () => {
    const entries = collapseDescriptionEdits([
      { row: row(1), actor_name: "You" },
      { row: row(2, { created_at: "2026-10-10T10:02:00.000Z" }), actor_name: "You" },
      { row: row(3, { created_at: "2026-10-10T10:04:00.000Z" }), actor_name: "You" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ seq: 1, last_seq: 3, old_value: "0", new_value: "3", merged_count: 3, created_at: "2026-10-10T10:00:00.000Z" });
  });

  it("falls back to the actor id when the actor row is gone and never merges non-description rows", () => {
    const entries = collapseDescriptionEdits([
      { row: row(1, { field: "name" }), actor_name: null },
      { row: row(2, { field: "name" }), actor_name: null },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].actor_name).toBe("a");
  });
});
