import { describe, expect, it } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { setAssignees, subscribe } from "@/lib/tessera/assignees";
import { createComment } from "@/lib/tessera/comments";
import { archiveNotifications, getUnreadCount, listNotifications, markNotificationsRead, snoozeNotifications } from "@/lib/tessera/notifications";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

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
