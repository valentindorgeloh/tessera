import { describe, expect, it } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { subscribe } from "@/lib/tessera/assignees";
import { createComment } from "@/lib/tessera/comments";
import { TrackerError } from "@/lib/tessera/core/errors";
import { digestInputs, getStoredDigest, saveDigest } from "@/lib/tessera/ai/digest-store";
import { archiveNotifications, listNotifications, markNotificationsRead, snoozeNotifications } from "@/lib/tessera/notifications";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "../helpers/db";

function otherState(ctx: ReturnType<typeof createTestContext>, projectId: string, current: string): string {
  const next = listStates(ctx, projectId).find((state) => state.id !== current);
  if (!next) throw new Error("expected another state");
  return next.id;
}

describe("inbox digest inputs", () => {
  it("summarises the recipient's unread inbox and the activity those rows cover", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const other = createWorkItem(ctx, { project_id: project.id, name: "Elsewhere" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:digest" });
    subscribe(ctx, item.id, agent.id);
    updateWorkItem(ctx, item.id, { state_id: otherState(ctx, project.id, item.state_id) });
    createComment(ctx, item.id, { body_md: "Needs a decision" });
    updateWorkItem(ctx, other.id, { state_id: otherState(ctx, project.id, other.state_id) });

    const agentCtx = createTestContext(handles, agent.id);
    const inputs = digestInputs(agentCtx, "inbox", agent.id);
    expect(inputs.subject).toBe("Inbox");
    expect(inputs.notifications?.map((note) => note.kind).sort()).toEqual(["commented", "state_changed"]);
    expect(inputs.notifications?.every((note) => note.work_item_key === "WEB-1")).toBe(true);
    expect(inputs.activity.some((row) => row.work_item_id === item.id && row.field === "state_id")).toBe(true);
    expect(inputs.activity.some((row) => row.work_item_id === item.id && row.verb === "commented")).toBe(true);
    expect(inputs.activity.some((row) => row.work_item_id === other.id)).toBe(false);
    expect(inputs.input_seq).toBe(Math.max(...inputs.activity.map((row) => row.last_seq)));
    expect(digestInputs(ctx, "inbox", ctx.actor.id).notifications).toEqual([]);

    const comment = inputs.notifications?.find((note) => note.kind === "commented");
    const notes = listNotifications(agentCtx);
    const commentId = notes.find((note) => note.kind === "commented")?.uid;
    expect(commentId).toBeDefined();
    markNotificationsRead(agentCtx, { ids: [commentId!] });
    const afterRead = digestInputs(agentCtx, "inbox", agent.id);
    expect(afterRead.notifications?.map((note) => note.kind)).toEqual(["state_changed"]);
    expect(afterRead.activity.some((row) => row.verb === "commented")).toBe(false);
    expect(comment?.snippet).toBe("Needs a decision");

    const stateId = notes.find((note) => note.kind === "state_changed")?.uid;
    expect(stateId).toBeDefined();
    snoozeNotifications(agentCtx, { ids: [stateId!], until: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(digestInputs(agentCtx, "inbox", agent.id).notifications).toEqual([]);

    const archived = registerActor(ctx, { kind: "agent", name: "mcp:archived" });
    subscribe(ctx, item.id, archived.id);
    createComment(ctx, item.id, { body_md: "Archive me" });
    const archivedCtx = createTestContext(handles, archived.id);
    const archivedNote = listNotifications(archivedCtx).find((note) => note.kind === "commented");
    expect(archivedNote).toBeDefined();
    archiveNotifications(archivedCtx, { ids: [archivedNote!.uid] });
    expect(digestInputs(archivedCtx, "inbox", archived.id).notifications).toEqual([]);
  });

  it("is stale once a newer covered activity row exists, and refuses an unknown actor", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:stale" });
    subscribe(ctx, item.id, agent.id);
    const states = listStates(ctx, project.id);
    const firstState = states.find((state) => state.id !== item.state_id);
    const secondState = states.find((state) => state.id !== item.state_id && state.id !== firstState?.id);
    expect(firstState).toBeDefined();
    expect(secondState).toBeDefined();
    updateWorkItem(ctx, item.id, { state_id: firstState!.id });

    const agentCtx = createTestContext(handles, agent.id);
    const first = digestInputs(agentCtx, "inbox", agent.id);
    expect(getStoredDigest(agentCtx, "inbox", agent.id)).toBeNull();
    const stored = saveDigest(agentCtx, {
      kind: "inbox",
      entity_id: agent.id,
      input_seq: first.input_seq,
      body_md: "Login changed state.",
      model: "claude-opus-5-5",
    });
    expect(stored.is_stale).toBe(false);
    expect(getStoredDigest(agentCtx, "inbox", agent.id)?.is_stale).toBe(false);

    updateWorkItem(ctx, item.id, { state_id: secondState!.id });
    const again = digestInputs(agentCtx, "inbox", agent.id);
    expect(again.input_seq).toBeGreaterThan(first.input_seq);
    expect(getStoredDigest(agentCtx, "inbox", agent.id)?.is_stale).toBe(true);

    expect(() => digestInputs(ctx, "inbox", "00000000-0000-7000-8000-000000000099")).toThrow(TrackerError);
  });
});
