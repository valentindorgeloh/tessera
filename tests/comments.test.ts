import { describe, expect, it } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { commentSnippet, createComment, deleteComment, listComments, updateComment } from "@/lib/tessera/comments";
import { withActor } from "@/lib/tessera/core/context";
import { isTrackerError } from "@/lib/tessera/core/errors";
import { activity, comment } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { archiveWorkItem, createWorkItem, getWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
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

function setup() {
  const ctx = createTestContext(createTestDb());
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
  return { ctx, item };
}

describe("comments", () => {
  it("attaches a reply to a reply to the root", () => {
    const { ctx, item } = setup();
    const root = createComment(ctx, item.id, { body_md: "Root" });
    const reply = createComment(ctx, item.id, { body_md: "Reply", parent_comment_id: root.id });
    const nested = createComment(ctx, item.id, { body_md: "Nested", parent_comment_id: reply.id });

    expect(nested.parent_comment_id).toBe(root.id);
    expect(nested.replies).toEqual([]);
    const listed = listComments(ctx, item.id);
    expect(listed.map((row) => row.id)).toEqual([root.id]);
    expect(listed[0]?.replies.map((row) => row.id)).toEqual([reply.id, nested.id]);
    expect(listed[0]?.replies.every((row) => row.replies.length === 0)).toBe(true);
    expect(listed[0]?.actor_name).toBe(ctx.actor.name);
    expect(listed[0]?.actor_kind).toBe("user");
    expect(listed[0]?.actor_color).toBe(ctx.actor.color);
    expect(listed[0]?.replies[1]?.actor_color).toBe(ctx.actor.color);
  });

  it("lets only the author update, with compare-and-swap, and records edited_at", () => {
    const { ctx, item } = setup();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:editor" });
    const agentCtx = withActor(ctx, agent.id);
    const created = createComment(agentCtx, item.id, { body_md: "Original" });

    expect(errorCode(() => updateComment(ctx, created.id, { body_md: "Nope", expected_body_version: 0 }))).toBe("RULE");
    expect(errorCode(() => updateComment(agentCtx, created.id, { body_md: "Stale", expected_body_version: 3 }))).toBe("CONFLICT");

    const updated = updateComment(agentCtx, created.id, { body_md: "Edited", expected_body_version: 0 });
    expect(updated.body_md).toBe("Edited");
    expect(updated.body_version).toBe(1);
    expect(updated.edited_at).not.toBeNull();
    const rows = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((row) => row.entity_type === "comment" && row.entity_id === created.id && row.verb === "updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.comment).toBe("Edited");
  });

  it("lets the user delete an agent's comment and soft-deletes its replies", () => {
    const { ctx, item } = setup();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:author" });
    const agentCtx = withActor(ctx, agent.id);
    const root = createComment(agentCtx, item.id, { body_md: "From the agent" });
    const reply = createComment(agentCtx, item.id, { body_md: "Also from the agent", parent_comment_id: root.id });
    const mine = createComment(ctx, item.id, { body_md: "From the user" });

    expect(errorCode(() => deleteComment(agentCtx, mine.id))).toBe("RULE");
    deleteComment(ctx, root.id);

    expect(listComments(ctx, item.id).map((row) => row.id)).toEqual([mine.id]);
    const stored = ctx.db
      .select()
      .from(comment)
      .all()
      .filter((row) => row.id === root.id || row.id === reply.id);
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.deleted_at !== null)).toBe(true);
    expect(errorCode(() => deleteComment(ctx, root.id))).toBe("NOT_FOUND");
  });

  it("refuses writes on an archived work item", () => {
    const { ctx, item } = setup();
    const created = createComment(ctx, item.id, { body_md: "Still here" });
    const done = listStates(ctx, item.project_id).find((state) => state.state_group === "completed");
    if (!done) throw new Error("missing completed state");
    updateWorkItem(ctx, item.id, { state_id: done.id });
    archiveWorkItem(ctx, item.id);

    expect(listComments(ctx, item.id)).toHaveLength(1);
    expect(errorCode(() => createComment(ctx, item.id, { body_md: "New" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateComment(ctx, created.id, { body_md: "Edit", expected_body_version: 0 }))).toBe("ARCHIVED");
    expect(errorCode(() => deleteComment(ctx, created.id))).toBe("ARCHIVED");
  });

  it("subscribes the author", () => {
    const { ctx, item } = setup();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:subscriber" });
    createComment(withActor(ctx, agent.id), item.id, { body_md: "I am following this" });
    expect(getWorkItem(ctx, item.id).subscriber_ids).toContain(agent.id);
  });

  it("stores the first 140 characters of the plain-text body on the activity row", () => {
    const md = "See **bold** and [the docs](https://example.com/docs).\n```ts\nsecret()\n```";
    expect(commentSnippet(md)).toBe("See bold and the docs.");
    expect(commentSnippet("hello [@Ada](actor:00000000-0000-7000-8000-000000000001)")).toBe("hello @Ada");
    expect(commentSnippet("a".repeat(200))).toHaveLength(140);

    const { ctx, item } = setup();
    const created = createComment(ctx, item.id, { body_md: `${"b".repeat(180)} **tail**` });
    const rows = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((row) => row.entity_type === "comment" && row.entity_id === created.id && row.verb === "commented");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.work_item_id).toBe(item.id);
    expect(rows[0]?.comment).toBe(commentSnippet(`${"b".repeat(180)} **tail**`));
    expect(rows[0]?.comment).toHaveLength(140);
  });
});
