/**
 * GET /api/changes (src/app/api/changes/route.ts) against an in-memory
 * database: `{ changes, cursor, latest_seq, unread_notifications }` (decisions 59
 * and 145). The
 * user's own writes are left out of `changes`; the unread count is the user's
 * (unread, not archived, not snoozed) and moves when a snooze wakes with no
 * new activity. `@/lib/tessera/server` is replaced by the engine barrel plus a
 * `getDb` over the test database (the real module's "server-only" guard throws
 * under plain Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { latestSeq } from "@/lib/tessera/activity";
import { registerActor } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { snoozeNotifications } from "@/lib/tessera/notifications";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type DbHandles } from "./helpers/db";

const db: { handles: DbHandles | null } = { handles: null };

vi.mock("@/lib/tessera/server", async () => {
  const engine = await vi.importActual<typeof import("@/lib/tessera")>("@/lib/tessera");
  return {
    ...engine,
    getDb: () => {
      if (db.handles === null) throw new Error("test database not open");
      return db.handles;
    },
    readTessera: async <T>(fn: (ctx: ReturnType<typeof createTestContext>) => T | Promise<T>): Promise<T> => {
      if (db.handles === null) throw new Error("test database not open");
      return fn(createTestContext(db.handles));
    },
  };
});

const { GET } = await import("@/app/api/changes/route");

async function get(since: string): Promise<Response> {
  return GET(new NextRequest(`http://127.0.0.1:3000/api/changes?since=${since}`));
}

let handles: DbHandles;

beforeEach(() => {
  handles = createTestDb();
  db.handles = handles;
});

afterEach(() => {
  handles.sqlite.close();
  db.handles = null;
});

describe("GET /api/changes", () => {
  it("returns changes, cursor, latest_seq and the unread notification count, uncached", async () => {
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(user, { project_id: project.id, name: "Login" });
    const agent = registerActor(user, { kind: "agent", name: "mcp:poller" });
    updateWorkItem(createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id }), item.id, { priority: "high" });

    const response = await get("0");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { changes: { actor_id: string }[]; cursor: number; latest_seq: number; unread_notifications: number };
    expect(body.changes.length).toBeGreaterThan(0);
    expect(body.changes.every((change) => change.actor_id === agent.id)).toBe(true);
    expect(body.cursor).toBeGreaterThan(0);
    expect(body.latest_seq).toBe(body.cursor);
    expect(latestSeq(user)).toBe(body.latest_seq);
    expect(body.unread_notifications).toBe(1);
  });

  it("latest_seq is the real newest seq even when it is below the caller's cursor (a rewound history)", async () => {
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    createWorkItem(user, { project_id: project.id, name: "Login" });
    const newest = latestSeq(user);
    const since = newest + 50;
    const body = (await (await get(String(since))).json()) as { changes: unknown[]; cursor: number; latest_seq: number };
    expect(body.changes).toEqual([]);
    expect(body.cursor).toBe(since);
    expect(body.latest_seq).toBe(newest);
    expect(body.latest_seq).toBeLessThan(since);
  });

  it("reports the count with no new changes, and a snooze lowers it without any activity", async () => {
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(user, { project_id: project.id, name: "Login" });
    const agent = registerActor(user, { kind: "agent", name: "mcp:poller" });
    updateWorkItem(createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id }), item.id, { priority: "high" });
    const first = (await (await get("0")).json()) as { cursor: number; unread_notifications: number };

    const quiet = (await (await get(String(first.cursor))).json()) as { changes: unknown[]; unread_notifications: number };
    expect(quiet.changes).toEqual([]);
    expect(quiet.unread_notifications).toBe(1);

    const uid = (handles.sqlite.prepare("SELECT uid FROM notification").get() as { uid: string }).uid;
    snoozeNotifications(user, { ids: [uid], until: "2099-01-01T00:00:00.000Z" });
    const snoozed = (await (await get(String(first.cursor))).json()) as { unread_notifications: number };
    expect(snoozed.unread_notifications).toBe(0);
  });

  it("rejects a missing or malformed since", async () => {
    expect((await get("abc")).status).toBe(400);
  });
});
