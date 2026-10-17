import { describe, expect, it } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { createComment } from "@/lib/tessera/comments";
import { withActor } from "@/lib/tessera/core/context";
import { isTrackerError } from "@/lib/tessera/core/errors";
import { activity, notification } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { REACTION_EMOJI, addReaction, reactionsFor, removeReaction } from "@/lib/tessera/reactions";
import { listStates } from "@/lib/tessera/states";
import { archiveWorkItem, createWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    if (isTrackerError(err)) return err.code;
    throw err;
  }
}

function verbs(ctx: ReturnType<typeof createTestContext>, verb: string): number {
  return ctx.db
    .select()
    .from(activity)
    .all()
    .filter((row) => row.verb === verb).length;
}

describe("reactions", () => {
  it("adds each emoji once, groups actors, and ignores a repeat add", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:reactor" });
    const agentCtx = withActor(ctx, agent.id);

    for (const reaction of REACTION_EMOJI) addReaction(ctx, { target: "work_item", target_id: item.id, reaction });
    const again = addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👍" });
    expect(again.map((row) => row.reaction)).toEqual([...REACTION_EMOJI]);
    expect(again.find((row) => row.reaction === "👍")).toEqual({ reaction: "👍", count: 1, actor_ids: [ctx.actor.id] });
    expect(verbs(ctx, "reacted")).toBe(REACTION_EMOJI.length);

    const shared = addReaction(agentCtx, { target: "work_item", target_id: item.id, reaction: "👍" });
    const thumbs = shared.find((row) => row.reaction === "👍");
    expect(thumbs?.count).toBe(2);
    expect(thumbs?.actor_ids).toEqual(expect.arrayContaining([ctx.actor.id, agent.id]));

    const comment = createComment(ctx, item.id, { body_md: "Nice" });
    const onComment = addReaction(ctx, { target: "comment", target_id: comment.id, reaction: "🎉" });
    expect(onComment).toEqual([{ reaction: "🎉", count: 1, actor_ids: [ctx.actor.id] }]);
    const batched = reactionsFor(ctx, "work_item", [item.id, "00000000-0000-7000-8000-000000000099"]);
    expect(batched.get(item.id)?.map((row) => row.reaction)).toEqual([...REACTION_EMOJI]);
    expect(batched.get("00000000-0000-7000-8000-000000000099")).toEqual([]);
  });

  it("treats a missing reaction as a no-op and logs unreacted only when a row goes", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });

    expect(removeReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👀" })).toEqual([]);
    expect(verbs(ctx, "unreacted")).toBe(0);

    addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👀" });
    expect(removeReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👀" })).toEqual([]);
    expect(verbs(ctx, "unreacted")).toBe(1);
    removeReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👀" });
    expect(verbs(ctx, "unreacted")).toBe(1);

    const rows = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((row) => row.verb === "reacted" || row.verb === "unreacted");
    expect(rows.every((row) => row.work_item_id === item.id && row.entity_type === "work_item")).toBe(true);
  });

  it("rejects an emoji outside the set and writes no notification", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });

    expect(errorCode(() => addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "🔥" as "👍" }))).toBe("VALIDATION");
    expect(errorCode(() => addReaction(ctx, { target: "nope" as "work_item", target_id: item.id, reaction: "👍" }))).toBe("VALIDATION");
    addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "🚀" });
    removeReaction(ctx, { target: "work_item", target_id: item.id, reaction: "🚀" });
    expect(ctx.db.select().from(notification).all()).toEqual([]);
  });

  it("refuses reactions on an archived work item", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const done = listStates(ctx, project.id).find((state) => state.state_group === "completed");
    if (!done) throw new Error("missing completed state");
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login", state_id: done.id });
    archiveWorkItem(ctx, item.id);
    expect(errorCode(() => addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👍" }))).toBe("ARCHIVED");
  });
});
