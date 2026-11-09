import { describe, expect, it } from "vitest";
import { notificationPhrase } from "@/components/inbox/inbox-format";
import { registerActor, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { setAssignees, subscribe } from "@/lib/tessera/assignees";
import { createComment } from "@/lib/tessera/comments";
import { logActivity } from "@/lib/tessera/activity";
import { ASSISTANT_ACTOR_ID } from "@/lib/tessera/actors";
import { activity } from "@/lib/tessera/db/schema";
import { eq } from "drizzle-orm";
import { withTx } from "@/lib/tessera/core/tx";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import {
  archiveNotifications,
  COALESCE_WINDOW_MS,
  getUnreadCount,
  listNotifications,
  markNotificationsRead,
  markNotificationsUnread,
  NOTIFICATION_KIND_RANK,
  snoozeNotifications,
  unsnoozeNotifications,
} from "@/lib/tessera/notifications";
import { createProject, updateProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createWorkItem, getWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type DbHandles } from "./helpers/db";

describe("notifications", () => {
  it("notifies a subscriber on a state change and not the actor", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:notify" });
    subscribe(ctx, item.id, agent.id);
    const states = listStates(ctx, project.id);
    const next = states.find((state) => state.id !== item.state_id);
    expect(next).toBeDefined();
    updateWorkItem(ctx, item.id, { state_id: next!.id });
    const back = states.find((state) => state.id !== next!.id);
    updateWorkItem(ctx, item.id, { state_id: back!.id });

    const agentCtx = createTestContext(handles, agent.id);
    const notes = listNotifications(agentCtx).filter((note) => note.work_item_id === item.id && note.kind === "state_changed");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.work_item_key).toBe("WEB-1");
    expect(listNotifications(ctx).filter((note) => note.kind === "state_changed")).toHaveLength(0);

    const read = markNotificationsRead(agentCtx, { ids: [notes[0]!.uid] });
    expect(read.updated).toBe(1);
    expect(listNotifications(agentCtx)[0]?.read_at).not.toBeNull();
  });

  it("notifies a mention as mentioned and other subscribers as commented", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:mention" });
    const other = registerActor(ctx, { kind: "agent", name: "mcp:other" });
    subscribe(ctx, item.id, other.id);
    createComment(ctx, item.id, { body_md: `See [@Agent](actor:${agent.id})` });

    const mentioned = listNotifications(createTestContext(handles, agent.id));
    expect(mentioned.map((note) => note.kind)).toEqual(["mentioned"]);
    expect(mentioned[0]).toMatchObject({ actor_id: ctx.actor.id, actor_kind: "user", actor_color: ctx.actor.color });
    const commented = listNotifications(createTestContext(handles, other.id)).filter((note) => note.kind === "commented");
    expect(commented).toHaveLength(1);
    expect(listNotifications(ctx).filter((note) => note.kind === "commented" || note.kind === "mentioned")).toHaveLength(0);
  });

  it("notifies the new assignee", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:assign" });
    setAssignees(ctx, item.id, [agent.id]);
    const notes = listNotifications(createTestContext(handles, agent.id));
    expect(notes.map((note) => note.kind)).toContain("assigned");
  });

  it("counts unread rows for the caller and skips read, archived, snoozed and the actor", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:count" });
    const agentCtx = createTestContext(handles, agent.id);
    const names = ["Read", "Archived", "Snoozed", "Awake", "Open"] as const;
    const items = names.map((name) => createWorkItem(ctx, { project_id: project.id, name }));
    for (const item of items) subscribe(ctx, item.id, agent.id);
    const states = listStates(ctx, project.id);
    const next = states.find((state) => state.id !== items[0]!.state_id);
    expect(next).toBeDefined();
    for (const item of items) updateWorkItem(ctx, item.id, { state_id: next!.id });

    expect(getUnreadCount(ctx)).toBe(0);
    expect(getUnreadCount(agentCtx)).toBe(names.length);

    const byName = new Map(listNotifications(agentCtx).map((note) => [note.title, note.uid]));
    markNotificationsRead(agentCtx, { ids: [byName.get("Read")!] });
    archiveNotifications(agentCtx, { ids: [byName.get("Archived")!] });
    snoozeNotifications(agentCtx, { ids: [byName.get("Snoozed")!], until: "2099-01-01T00:00:00.000Z" });
    snoozeNotifications(agentCtx, { ids: [byName.get("Awake")!], until: "2000-01-01T00:00:00.000Z" });
    expect(getUnreadCount(agentCtx)).toBe(2);
  });
});

const T0 = Date.parse("2030-01-01T12:00:00.000Z");

/** A context whose clock reads `clock.at` (ms since the epoch), so the coalescing window is exact. */
function clockCtx(handles: DbHandles, actorId: string, clock: { at: number }): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId, now: () => new Date(clock.at).toISOString() });
}

/** The user creates an item and an agent follows it; the agent is the recipient under test. */
function coalesceSetup() {
  const handles = createTestDb();
  const clock = { at: T0 };
  const user = clockCtx(handles, createTestContext(handles).actor.id, clock);
  const project = createProject(user, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(user, { project_id: project.id, name: "Login" });
  const reader = registerActor(user, { kind: "agent", name: "mcp:reader" });
  const writer = registerActor(user, { kind: "agent", name: "mcp:writer" });
  subscribe(user, item.id, reader.id);
  return {
    handles,
    clock,
    user,
    item,
    project,
    readerId: reader.id,
    readerCtx: clockCtx(handles, reader.id, clock),
    writerCtx: clockCtx(handles, writer.id, clock),
    writerId: writer.id,
    inbox: () => listNotifications(clockCtx(handles, reader.id, clock)).filter((note) => note.work_item_id === item.id),
  };
}

describe("coalescing (decision 51)", () => {
  it("ranks the kinds in the decision's order", () => {
    expect(Object.keys(NOTIFICATION_KIND_RANK)).toEqual(["mentioned", "assigned", "commented", "state_changed", "updated", "intake_received", "automation"]);
    expect(COALESCE_WINDOW_MS).toBe(600_000);
  });

  it("merges events by one actor under ten minutes apart: event_count, newest snippet, sort_at, kept created_at", () => {
    const { clock, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    const first = inbox();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "commented", event_count: 1, snippet: "first" });
    clock.at = T0 + 9 * 60_000 + 59_000;
    createComment(writerCtx, item.id, { body_md: "second" });
    const rows = inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "commented", event_count: 2, snippet: "second" });
    expect(rows[0]?.sort_at).toBe(new Date(clock.at).toISOString());
    expect(rows[0]?.created_at).toBe(new Date(T0).toISOString());
    clock.at += 9 * 60_000;
    createComment(writerCtx, item.id, { body_md: "third" });
    expect(inbox()[0]).toMatchObject({ event_count: 3, snippet: "third" });
  });

  it("starts a new row at the window edge (strictly under ten minutes merges)", () => {
    const { clock, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    clock.at = T0 + COALESCE_WINDOW_MS;
    createComment(writerCtx, item.id, { body_md: "at ten" });
    expect(inbox()).toHaveLength(2);
    clock.at += COALESCE_WINDOW_MS + 1_000;
    createComment(writerCtx, item.id, { body_md: "later" });
    expect(inbox()).toHaveLength(3);
    expect(inbox().map((note) => note.event_count)).toEqual([1, 1, 1]);
  });

  it("keeps rows of different causing actors apart", () => {
    const { handles, clock, writerCtx, item, inbox } = coalesceSetup();
    const other = registerActor(createTestContext(handles), { kind: "agent", name: "mcp:other" });
    createComment(writerCtx, item.id, { body_md: "from writer" });
    createComment(clockCtx(handles, other.id, clock), item.id, { body_md: "from other" });
    createComment(writerCtx, item.id, { body_md: "from writer again" });
    const rows = inbox();
    expect(rows.filter((note) => note.event_count === 2)).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it.each([
    ["read", (ctx: TesseraContext, uid: string) => markNotificationsRead(ctx, { ids: [uid] })],
    ["archived", (ctx: TesseraContext, uid: string) => archiveNotifications(ctx, { ids: [uid] })],
    ["snoozed", (ctx: TesseraContext, uid: string) => snoozeNotifications(ctx, { ids: [uid], until: "2030-01-02T00:00:00.000Z" })],
  ])("does not merge into a %s row", (_name, change) => {
    const { readerCtx, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    change(readerCtx, inbox()[0]!.uid);
    createComment(writerCtx, item.id, { body_md: "second" });
    const rows = inbox();
    expect(rows).toHaveLength(2);
    expect(rows.map((note) => note.event_count)).toEqual([1, 1]);
  });

  it("merges into a woken snoozed row again", () => {
    const { clock, readerCtx, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    snoozeNotifications(readerCtx, { ids: [inbox()[0]!.uid], until: new Date(T0 + 60_000).toISOString() });
    clock.at = T0 + 120_000;
    createComment(writerCtx, item.id, { body_md: "after wake" });
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({ event_count: 2, snippet: "after wake" });
  });

  it("upgrades the kind to the higher rank and never downgrades it", () => {
    const { clock, writerCtx, readerId, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "plain" });
    expect(inbox()[0]?.kind).toBe("commented");
    // The mention row merges in and upgrades the kind; the reader is left out of the commented recipients of that comment.
    createComment(writerCtx, item.id, { body_md: `ping [@Reader](actor:${readerId})` });
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({ kind: "mentioned", event_count: 2 });
    clock.at += 60_000;
    createComment(writerCtx, item.id, { body_md: "plain again" });
    expect(inbox()[0]).toMatchObject({ kind: "mentioned", event_count: 3, snippet: "plain again" });
  });

  it("counts the kind separately from the events (kind_count, decision 51)", () => {
    const { clock, writerCtx, item, inbox } = coalesceSetup();
    const read = () => {
      const row = inbox()[0]!;
      return [row.kind, row.kind_count, row.event_count, notificationPhrase(row.kind, row.kind_count, row.event_count)];
    };
    createComment(writerCtx, item.id, { body_md: "one" });
    expect(read()).toEqual(["commented", 1, 1, "commented"]);
    clock.at += 60_000;
    createComment(writerCtx, item.id, { body_md: "two" });
    expect(read()).toEqual(["commented", 2, 2, "commented 2 times"]);
    // A lower-ranked event adds to event_count only.
    clock.at += 60_000;
    updateWorkItem(writerCtx, item.id, { priority: "high" });
    expect(read()).toEqual(["commented", 2, 3, "commented 2 times · +1 more"]);
  });

  it("reads 'commented · +1 more' for a state change then a comment, and for a comment then a state change", () => {
    const first = coalesceSetup();
    const states = listStates(first.user, first.project.id);
    const next = states.find((state) => state.id !== first.item.state_id)!;
    updateWorkItem(first.writerCtx, first.item.id, { state_id: next.id });
    expect(first.inbox()[0]).toMatchObject({ kind: "state_changed", kind_count: 1, event_count: 1 });
    first.clock.at += 60_000;
    createComment(first.writerCtx, first.item.id, { body_md: "after" });
    const a = first.inbox()[0]!;
    expect([a.kind, a.kind_count, a.event_count]).toEqual(["commented", 1, 2]);
    expect(notificationPhrase(a.kind, a.kind_count, a.event_count)).toBe("commented · +1 more");

    const second = coalesceSetup();
    createComment(second.writerCtx, second.item.id, { body_md: "before" });
    second.clock.at += 60_000;
    const nextInSecond = listStates(second.user, second.project.id).find((state) => state.id !== second.item.state_id)!;
    updateWorkItem(second.writerCtx, second.item.id, { state_id: nextInSecond.id });
    const b = second.inbox()[0]!;
    expect([b.kind, b.kind_count, b.event_count]).toEqual(["commented", 1, 2]);
    expect(notificationPhrase(b.kind, b.kind_count, b.event_count)).toBe("commented · +1 more");
  });

  it("comment, comment, state change reads 'commented 2 times · +1 more'; comment, comment, mention reads 'mentioned you · +2 more'", () => {
    const first = coalesceSetup();
    const next = listStates(first.user, first.project.id).find((state) => state.id !== first.item.state_id)!;
    createComment(first.writerCtx, first.item.id, { body_md: "a" });
    createComment(first.writerCtx, first.item.id, { body_md: "b" });
    updateWorkItem(first.writerCtx, first.item.id, { state_id: next.id });
    const a = first.inbox()[0]!;
    expect(notificationPhrase(a.kind, a.kind_count, a.event_count)).toBe("commented 2 times · +1 more");

    const second = coalesceSetup();
    createComment(second.writerCtx, second.item.id, { body_md: "a" });
    createComment(second.writerCtx, second.item.id, { body_md: "b" });
    createComment(second.writerCtx, second.item.id, { body_md: `ping [@Reader](actor:${second.readerId})` });
    const b = second.inbox()[0]!;
    expect([b.kind, b.kind_count, b.event_count]).toEqual(["mentioned", 1, 3]);
    expect(notificationPhrase(b.kind, b.kind_count, b.event_count)).toBe("mentioned you · +2 more");
  });

  it("a row from before kind_count (default 1, event_count 3) reads 'commented · +2 more'", () => {
    const { handles, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "legacy" });
    handles.sqlite.prepare("UPDATE notification SET event_count = 3, kind_count = 1").run();
    const row = inbox()[0]!;
    expect(notificationPhrase(row.kind, row.kind_count, row.event_count)).toBe("commented · +2 more");
  });

  it("lists by sort_at then seq, newest first", () => {
    const { clock, user, writerCtx, item, project, readerCtx, readerId } = coalesceSetup();
    const second = createWorkItem(user, { project_id: project.id, name: "Second" });
    subscribe(user, second.id, readerId);
    createComment(writerCtx, item.id, { body_md: "a1" });
    clock.at += 60_000;
    createComment(writerCtx, second.id, { body_md: "b1" });
    expect(listNotifications(readerCtx).map((note) => note.work_item_id)).toEqual([second.id, item.id]);
    clock.at += 60_000;
    createComment(writerCtx, item.id, { body_md: "a2" });
    const rows = listNotifications(readerCtx);
    expect(rows.map((note) => note.work_item_id)).toEqual([item.id, second.id]);
    expect(rows.map((note) => note.event_count)).toEqual([2, 1]);
  });
});

describe("what notifies (decisions 50, 51)", () => {
  it("never notifies for a subscribers row, sort_order, created, copied, reacted or unreacted", () => {
    const { writerCtx, item, inbox } = coalesceSetup();
    subscribe(writerCtx, item.id, writerCtx.actor.id);
    withTx(writerCtx, () => {
      const base = { project_id: item.project_id, entity_type: "work_item", entity_id: item.id, work_item_id: item.id };
      logActivity(writerCtx, { ...base, verb: "updated", field: "sort_order" });
      for (const verb of ["created", "copied", "reacted", "unreacted"]) logActivity(writerCtx, { ...base, verb });
    });
    expect(inbox()).toHaveLength(0);
    // The agent's first comment logs "added subscribers" and "commented": one event, not two.
    createComment(writerCtx, item.id, { body_md: "hello" });
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]?.event_count).toBe(1);
  });

  it("writes an updated row for a priority change on a subscribed item", () => {
    const { writerCtx, item, inbox } = coalesceSetup();
    updateWorkItem(writerCtx, item.id, { priority: "high" });
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({ kind: "updated", event_count: 1 });
    updateWorkItem(writerCtx, item.id, { priority: "low" });
    expect(inbox()[0]).toMatchObject({ kind: "updated", event_count: 2 });
  });

  it("never tells the user about the assistant's change, nor the assistant anything", () => {
    const { handles, clock, user, item, inbox } = coalesceSetup();
    const assistant = clockCtx(handles, ASSISTANT_ACTOR_ID, clock);
    subscribe(user, item.id, ASSISTANT_ACTOR_ID);
    updateWorkItem(assistant, item.id, { priority: "high" });
    createComment(assistant, item.id, { body_md: "Applied" });
    expect(listNotifications(user)).toHaveLength(0);
    expect(listNotifications(assistant)).toHaveLength(0);
    // An MCP agent subscribed to the item still hears about it: both events merged.
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({ kind: "commented", event_count: 2 });
  });

  it("tells the user about an agent's change and not about the user's own", () => {
    const { user, writerCtx, item } = coalesceSetup();
    updateWorkItem(user, item.id, { priority: "high" });
    expect(listNotifications(user)).toHaveLength(0);
    updateWorkItem(writerCtx, item.id, { priority: "low" });
    expect(listNotifications(user).map((note) => note.kind)).toEqual(["updated"]);
  });

  it("skips a deleted actor", () => {
    const { handles, writerCtx, readerId, item } = coalesceSetup();
    handles.sqlite.prepare("UPDATE actor SET deleted_at = ? WHERE id = ?").run(new Date(T0).toISOString(), readerId);
    updateWorkItem(writerCtx, item.id, { priority: "high" });
    const count = handles.sqlite.prepare("SELECT count(*) AS n FROM notification WHERE recipient_actor_id = ?").get(readerId) as { n: number };
    expect(count.n).toBe(0);
  });
});

describe("read, archive and snooze (decision 52)", () => {
  it("snooze sets sort_at to the wake time and clears read; the badge excludes it until it wakes", () => {
    const { clock, readerCtx, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    const uid = inbox()[0]!.uid;
    markNotificationsRead(readerCtx, { ids: [uid] });
    expect(getUnreadCount(readerCtx)).toBe(0);
    const until = new Date(T0 + 3_600_000).toISOString();
    snoozeNotifications(readerCtx, { ids: [uid], until });
    const snoozed = inbox()[0]!;
    expect(snoozed).toMatchObject({ read_at: null, sort_at: until, snoozed_till: until, is_snoozed: true });
    expect(getUnreadCount(readerCtx)).toBe(0);
    clock.at = T0 + 3_600_000;
    expect(getUnreadCount(readerCtx)).toBe(1);
    expect(inbox()[0]).toMatchObject({ is_snoozed: false, read_at: null });
  });

  it("a woken row sorts above rows created while it slept", () => {
    const { clock, user, readerCtx, writerCtx, item, project, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    const uid = inbox()[0]!.uid;
    snoozeNotifications(readerCtx, { ids: [uid], until: new Date(T0 + 30 * 60_000).toISOString() });
    const other = createWorkItem(user, { project_id: project.id, name: "Other" });
    subscribe(user, other.id, readerCtx.actor.id);
    clock.at = T0 + 5 * 60_000;
    updateWorkItem(writerCtx, other.id, { priority: "high" });
    clock.at = T0 + 40 * 60_000;
    expect(listNotifications(readerCtx).map((note) => note.uid)[0]).toBe(uid);
  });

  it("unsnooze clears snoozed_till and sets sort_at to now", () => {
    const { clock, readerCtx, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    const uid = inbox()[0]!.uid;
    snoozeNotifications(readerCtx, { ids: [uid], until: new Date(T0 + 3_600_000).toISOString() });
    clock.at = T0 + 60_000;
    unsnoozeNotifications(readerCtx, { ids: [uid] });
    expect(inbox()[0]).toMatchObject({ snoozed_till: null, is_snoozed: false, sort_at: new Date(clock.at).toISOString() });
  });

  it("archive keeps the read state, and a snoozed row leaves its future sort_at behind", () => {
    const { clock, readerCtx, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    const uid = inbox()[0]!.uid;
    markNotificationsRead(readerCtx, { ids: [uid] });
    archiveNotifications(readerCtx, { ids: [uid] });
    expect(inbox()[0]).toMatchObject({ read_at: expect.any(String) });
    markNotificationsUnread(readerCtx, { ids: [uid] });
    snoozeNotifications(readerCtx, { ids: [uid], until: new Date(T0 + 3_600_000).toISOString() });
    clock.at = T0 + 1_000;
    archiveNotifications(readerCtx, { ids: [uid] });
    expect(inbox()[0]).toMatchObject({ read_at: null, snoozed_till: null, sort_at: new Date(clock.at).toISOString() });
  });

  it("mark all read leaves a still-snoozed row unread", () => {
    const { readerCtx, writerCtx, item, inbox } = coalesceSetup();
    createComment(writerCtx, item.id, { body_md: "first" });
    snoozeNotifications(readerCtx, { ids: [inbox()[0]!.uid], until: "2099-01-01T00:00:00.000Z" });
    expect(markNotificationsRead(readerCtx, { ids: [], all: true }).updated).toBe(0);
    expect(inbox()[0]?.read_at).toBeNull();
  });
});

describe("assignees set at create time (decisions 50, 51)", () => {
  function createSetup() {
    const handles = createTestDb();
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const agent = registerActor(user, { kind: "agent", name: "mcp:creator" });
    const agentCtx = createTestContext(handles, agent.id);
    const assignments = (ctx: TesseraContext) => listNotifications(ctx).filter((note) => note.kind === "assigned");
    return { handles, user, project, agent, agentCtx, assignments };
  }

  it("an agent creating an item assigned to the user gives the user one assigned row", () => {
    const { user, project, agentCtx, assignments } = createSetup();
    const item = createWorkItem(agentCtx, { project_id: project.id, name: "From agent", assignee_ids: [USER_ACTOR_ID] });
    const rows = assignments(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ work_item_id: item.id, kind_count: 1, event_count: 1 });
    expect(notificationPhrase(rows[0]!.kind, rows[0]!.kind_count, rows[0]!.event_count)).toBe("assigned you");
  });

  it("the user creating an item assigned to an agent gives the agent an assigned row, and the user none", () => {
    const { user, project, agent, agentCtx, assignments } = createSetup();
    const item = createWorkItem(user, { project_id: project.id, name: "For agent", assignee_ids: [agent.id] });
    expect(assignments(agentCtx).map((note) => note.work_item_id)).toEqual([item.id]);
    expect(listNotifications(user)).toHaveLength(0);
  });

  it("a self-assignment notifies nobody", () => {
    const { user, project, agentCtx, assignments } = createSetup();
    createWorkItem(user, { project_id: project.id, name: "Mine", assignee_ids: [USER_ACTOR_ID] });
    createWorkItem(agentCtx, { project_id: project.id, name: "Mine too", assignee_ids: [agentCtx.actor.id] });
    expect(listNotifications(user)).toHaveLength(0);
    expect(assignments(agentCtx)).toHaveLength(0);
  });

  it("the project default assignee is notified like an explicit one", () => {
    const { user, project, agent, agentCtx, assignments } = createSetup();
    updateProject(user, project.id, { default_assignee_id: agent.id });
    const item = createWorkItem(user, { project_id: project.id, name: "Defaulted" });
    expect(getWorkItem(user, item.id).assignee_ids).toEqual([agent.id]);
    expect(assignments(agentCtx).map((note) => note.work_item_id)).toEqual([item.id]);
  });

  it("the assistant creating an item assigned to the user gives the user no row (decision 50)", () => {
    const { handles, user, project } = createSetup();
    const assistant = createTestContext(handles, ASSISTANT_ACTOR_ID);
    const item = createWorkItem(assistant, { project_id: project.id, name: "Assistant made", assignee_ids: [USER_ACTOR_ID] });
    expect(getWorkItem(user, item.id).assignee_ids).toEqual([USER_ACTOR_ID]);
    expect(listNotifications(user)).toHaveLength(0);
  });

  it("the new item's feed shows the assignment once, as a later setAssignees would, and subscribers have no duplicates", () => {
    const { handles, project, agent, agentCtx, user } = createSetup();
    const item = createWorkItem(agentCtx, { project_id: project.id, name: "Feed", assignee_ids: [USER_ACTOR_ID, agent.id] });
    const rows = handles.db.select().from(activity).where(eq(activity.entity_id, item.id)).orderBy(activity.seq).all();
    const assigned = rows.filter((row) => row.field === "assignees");
    expect(assigned.map((row) => [row.verb, row.new_value, row.new_identifier])).toEqual([
      ["added", USER_ACTOR_ID, "You"],
      ["added", agent.id, "mcp:creator"],
    ]);
    expect(rows.filter((row) => row.verb === "created")).toHaveLength(1);
    expect(rows.filter((row) => row.field === "subscribers")).toHaveLength(0);
    const subscribers = getWorkItem(user, item.id).subscriber_ids;
    expect([...subscribers].sort()).toEqual([USER_ACTOR_ID, agent.id].sort());
    expect(new Set(subscribers).size).toBe(subscribers.length);
  });
});
