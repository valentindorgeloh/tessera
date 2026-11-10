/**
 * Idempotent agent comments (decision 150): `create_comment` with a `client_ref`.
 * A repeat of the same caller, item and ref with the same body returns the stored
 * comment and changes nothing; a deleted comment answers `{ id, client_ref,
 * deleted: true }`; another body is CONFLICT. The lookup runs after the item
 * exists and before the archived check. Without a ref nothing changes.
 */
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { registerActor } from "@/lib/tessera/actors";
import {
  ClientRefSchema,
  createComment,
  deleteComment,
  getComment,
  listComments,
  updateComment,
  type CommentView,
  type DeletedCommentRef,
} from "@/lib/tessera/comments";
import { withActor, type TesseraContext } from "@/lib/tessera/core/context";
import { isTrackerError, type TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { comment } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { runToolWithContext } from "@/lib/tessera/tools/registry";
import { archiveWorkItem, createWorkItem, getWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { listStates } from "@/lib/tessera/states";
import { createTestContext, createTestDb } from "./helpers/db";

function thrown(fn: () => unknown): TrackerError | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    if (isTrackerError(err)) return err;
    throw err;
  }
}

async function thrownAsync(fn: () => Promise<unknown>): Promise<TrackerError | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (isTrackerError(err)) return err;
    throw err;
  }
}

function setup() {
  const ctx = createTestContext(createTestDb());
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
  const other = createWorkItem(ctx, { project_id: project.id, name: "Signup" });
  const target = registerActor(ctx, { kind: "agent", name: "mcp:target" });
  const agent = registerActor(ctx, { kind: "agent", name: "mcp:superagent" });
  const agentCtx = withActor(ctx, agent.id);
  return { ctx, agentCtx, agent, target, project, item, other };
}

/** Everything a comment write touches: rows, activity, notifications, mentions, subscriptions and the cursor. */
function footprint(ctx: TesseraContext) {
  const count = (table: string) => (ctx.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const events = (ctx.sqlite.prepare("SELECT coalesce(sum(event_count), 0) AS n FROM notification").get() as { n: number }).n;
  return {
    comments: count("comment"),
    activity: count("activity"),
    notifications: count("notification"),
    notificationEvents: events,
    mentions: count("mention"),
    subscribers: count("work_item_subscriber"),
    seq: latestSeq(ctx),
  };
}

/** The result of a call known to answer with a comment. */
function view(result: CommentView | DeletedCommentRef): CommentView {
  if ("deleted" in result) throw new Error("expected a comment, got a deleted ref");
  return result;
}

describe("ClientRefSchema", () => {
  it("accepts 1 to 200 printable ASCII characters without spaces", () => {
    for (const ref of ["a", "run-17/step.3", "!~", "x".repeat(200), "[@id](actor:1)", "!~"]) {
      expect(ClientRefSchema.safeParse(ref).success, ref).toBe(true);
    }
  });

  it("refuses empty, spaced, control, non-ASCII and over-long refs", () => {
    for (const ref of ["", " ", "a b", " a", "a ", "tab\there", "line\nbreak", "del\u007F", "café", "\u{1F680}", "x".repeat(201)]) {
      expect(ClientRefSchema.safeParse(ref).success, JSON.stringify(ref)).toBe(false);
    }
  });

  it("is described", () => {
    expect(ClientRefSchema.description).toMatch(/client_ref|Idempotency/);
  });
});

describe("createComment with client_ref", () => {
  it("creates the first comment with its ref and every view carries client_ref", () => {
    const { agentCtx, item } = setup();
    const created = view(createComment(agentCtx, item.id, { body_md: "Plan ready", client_ref: "run-1/plan" }));
    expect(created.client_ref).toBe("run-1/plan");
    expect(created.body_md).toBe("Plan ready");
    expect(created.actor_id).toBe(agentCtx.actor.id);
    expect(getComment(agentCtx, created.id).client_ref).toBe("run-1/plan");
    const reply = view(createComment(agentCtx, item.id, { body_md: "Details", parent_comment_id: created.id, client_ref: "run-1/details" }));
    expect(reply.client_ref).toBe("run-1/details");
    const listed = listComments(agentCtx, item.id);
    expect(listed[0]?.client_ref).toBe("run-1/plan");
    expect(listed[0]?.replies[0]?.client_ref).toBe("run-1/details");
  });

  it("a comment without a ref has client_ref null and two identical calls make two comments", () => {
    const { agentCtx, item } = setup();
    const first = createComment(agentCtx, item.id, { body_md: "Same" });
    const second = createComment(agentCtx, item.id, { body_md: "Same" });
    expect(first.client_ref).toBeNull();
    expect(second.id).not.toBe(first.id);
    expect(listComments(agentCtx, item.id)).toHaveLength(2);
  });

  it("a repeat with the same body returns the stored comment and writes nothing", () => {
    const { ctx, agentCtx, agent, target, item } = setup();
    // The body mentions another actor and the user is subscribed to the item, so a second write would add visible rows.
    const body = `Heads up [@target](actor:${target.id})`;
    const first = view(createComment(agentCtx, item.id, { body_md: body, client_ref: "run-2" }));
    expect(footprint(ctx).mentions).toBe(1);
    expect(footprint(ctx).notifications).toBeGreaterThan(0);
    // The author unsubscribed since: a repeat must not subscribe again.
    ctx.sqlite.prepare("DELETE FROM work_item_subscriber WHERE work_item_id = ? AND actor_id = ?").run(item.id, agent.id);
    const before = footprint(ctx);

    const again = createComment(agentCtx, item.id, { body_md: body, client_ref: "run-2" });

    expect(view(again)).toEqual(first);
    expect(footprint(ctx)).toEqual(before);
    expect(getWorkItem(ctx, item.id).subscriber_ids).not.toContain(agent.id);
    expect(listComments(ctx, item.id)).toHaveLength(1);
  });

  it("compares the trimmed body, so a repeat with surrounding whitespace is the same body", () => {
    const { agentCtx, item } = setup();
    const first = view(createComment(agentCtx, item.id, { body_md: "Done", client_ref: "r" }));
    expect(view(createComment(agentCtx, item.id, { body_md: "  Done\n", client_ref: "r" })).id).toBe(first.id);
  });

  it("another body with the same ref is CONFLICT with the comment id and the ref, and writes nothing", () => {
    const { ctx, agentCtx, item } = setup();
    const first = view(createComment(agentCtx, item.id, { body_md: "Original", client_ref: "run-3" }));
    const before = footprint(ctx);

    const err = thrown(() => createComment(agentCtx, item.id, { body_md: "Different", client_ref: "run-3" }));

    expect(err?.code).toBe("CONFLICT");
    expect(err?.details).toEqual({ comment_id: first.id, client_ref: "run-3" });
    expect(err?.message).toContain("client_ref");
    expect(footprint(ctx)).toEqual(before);
  });

  it("compares with the current body: after an edit the old body conflicts and the new body repeats", () => {
    const { agentCtx, item } = setup();
    const first = view(createComment(agentCtx, item.id, { body_md: "Draft", client_ref: "run-4" }));
    updateComment(agentCtx, first.id, { body_md: "Final", expected_body_version: 0 });

    expect(thrown(() => createComment(agentCtx, item.id, { body_md: "Draft", client_ref: "run-4" }))?.code).toBe("CONFLICT");
    const repeat = view(createComment(agentCtx, item.id, { body_md: "Final", client_ref: "run-4" }));
    expect(repeat.id).toBe(first.id);
    expect(repeat.body_version).toBe(1);
  });

  it("a deleted comment keeps its ref: a repeat returns { id, client_ref, deleted: true } and creates nothing", () => {
    const { ctx, agentCtx, item } = setup();
    const first = view(createComment(agentCtx, item.id, { body_md: "Oops", client_ref: "run-5" }));
    deleteComment(agentCtx, first.id);
    const before = footprint(ctx);

    expect(createComment(agentCtx, item.id, { body_md: "Oops", client_ref: "run-5" })).toEqual({ id: first.id, client_ref: "run-5", deleted: true });
    // Deleted wins over a different body: the ref is spent.
    expect(createComment(agentCtx, item.id, { body_md: "Other words", client_ref: "run-5" })).toEqual({ id: first.id, client_ref: "run-5", deleted: true });
    expect(footprint(ctx)).toEqual(before);
    expect(listComments(agentCtx, item.id)).toEqual([]);
  });

  it("a reply deleted together with its root also answers deleted", () => {
    const { agentCtx, item } = setup();
    const root = view(createComment(agentCtx, item.id, { body_md: "Root" }));
    const reply = view(createComment(agentCtx, item.id, { body_md: "Reply", parent_comment_id: root.id, client_ref: "reply-1" }));
    deleteComment(agentCtx, root.id);
    expect(createComment(agentCtx, item.id, { body_md: "Reply", parent_comment_id: root.id, client_ref: "reply-1" })).toEqual({
      id: reply.id,
      client_ref: "reply-1",
      deleted: true,
    });
  });

  it("another actor, another item or another ref gets its own comment", () => {
    const { ctx, agentCtx, item, other } = setup();
    const mine = view(createComment(agentCtx, item.id, { body_md: "Hello", client_ref: "shared" }));
    const users = view(createComment(ctx, item.id, { body_md: "Hello", client_ref: "shared" }));
    const elsewhere = view(createComment(agentCtx, other.id, { body_md: "Hello", client_ref: "shared" }));
    const another = view(createComment(agentCtx, item.id, { body_md: "Hello", client_ref: "shared-2" }));
    expect(new Set([mine.id, users.id, elsewhere.id, another.id]).size).toBe(4);
    expect(users.actor_id).toBe(ctx.actor.id);
    expect(elsewhere.work_item_id).toBe(other.id);
    // Each repeat finds its own.
    expect(view(createComment(agentCtx, item.id, { body_md: "Hello", client_ref: "shared" })).id).toBe(mine.id);
    expect(view(createComment(ctx, item.id, { body_md: "Hello", client_ref: "shared" })).id).toBe(users.id);
    expect(view(createComment(agentCtx, other.id, { body_md: "Hello", client_ref: "shared" })).id).toBe(elsewhere.id);
  });

  it("a repeat on an item archived since returns the comment; a new ref is still ARCHIVED", () => {
    const { ctx, agentCtx, item } = setup();
    const first = view(createComment(agentCtx, item.id, { body_md: "Before archive", client_ref: "run-6" }));
    const done = listStates(ctx, item.project_id).find((state) => state.state_group === "completed");
    if (!done) throw new Error("missing completed state");
    updateWorkItem(ctx, item.id, { state_id: done.id });
    archiveWorkItem(ctx, item.id);
    const before = footprint(ctx);

    expect(view(createComment(agentCtx, item.id, { body_md: "Before archive", client_ref: "run-6" })).id).toBe(first.id);
    expect(thrown(() => createComment(agentCtx, item.id, { body_md: "Before archive", client_ref: "run-7" }))?.code).toBe("ARCHIVED");
    expect(thrown(() => createComment(agentCtx, item.id, { body_md: "Changed", client_ref: "run-6" }))?.code).toBe("CONFLICT");
    expect(footprint(ctx)).toEqual(before);
  });

  it("a missing item is NOT_FOUND even when the ref exists on another item", () => {
    const { agentCtx, item } = setup();
    createComment(agentCtx, item.id, { body_md: "Here", client_ref: "run-8" });
    expect(thrown(() => createComment(agentCtx, newId(), { body_md: "Here", client_ref: "run-8" }))?.code).toBe("NOT_FOUND");
  });

  it("a bad ref is VALIDATION and writes nothing", () => {
    const { ctx, agentCtx, item } = setup();
    const before = footprint(ctx);
    for (const client_ref of ["", "has space", "x".repeat(201), "café"]) {
      expect(thrown(() => createComment(agentCtx, item.id, { body_md: "Hi", client_ref }))?.code, JSON.stringify(client_ref)).toBe("VALIDATION");
    }
    expect(footprint(ctx)).toEqual(before);
  });

  it("the unique index refuses a second live or deleted row for one actor, item and ref", () => {
    const { ctx, agentCtx, item, other } = setup();
    const a = view(createComment(agentCtx, item.id, { body_md: "A" }));
    const b = view(createComment(agentCtx, item.id, { body_md: "B" }));
    const c = view(createComment(agentCtx, other.id, { body_md: "C" }));
    const set = ctx.sqlite.prepare("UPDATE comment SET client_ref = ? WHERE id = ?");
    set.run("dup", a.id);
    expect(() => set.run("dup", b.id)).toThrow(/UNIQUE/);
    set.run("dup", c.id); // another item
    // A soft-deleted row keeps its ref and still holds the slot.
    deleteComment(agentCtx, a.id);
    expect(() => set.run("dup", b.id)).toThrow(/UNIQUE/);
    // Null refs never collide.
    expect(ctx.db.select().from(comment).all().filter((row) => row.client_ref === null).length).toBeGreaterThan(0);
  });
});

describe("create_comment tool with client_ref", () => {
  it("passes client_ref through: first call creates, a repeat returns the same comment, a deleted one answers the ref", async () => {
    const { agentCtx, item } = setup();
    const create = () => runToolWithContext(agentCtx, "create_comment", { work_item_id: item.id, body_md: "From the runner", client_ref: "tool-1" });

    const first = await create();
    const firstView = view(first.data);
    expect(firstView.client_ref).toBe("tool-1");
    const again = await create();
    expect(view(again.data).id).toBe(firstView.id);
    expect(again.cursor).toBe(first.cursor);

    const listed = await runToolWithContext(agentCtx, "list_comments", { work_item_id: item.id });
    expect(listed.data.items.map((row) => row.client_ref)).toEqual(["tool-1"]);

    await runToolWithContext(agentCtx, "delete_comment", { comment_id: firstView.id });
    const gone = await create();
    expect(gone.data).toEqual({ id: firstView.id, client_ref: "tool-1", deleted: true });
  });

  it("a different body is CONFLICT and a bad ref is VALIDATION", async () => {
    const { agentCtx, item } = setup();
    await runToolWithContext(agentCtx, "create_comment", { work_item_id: item.id, body_md: "One", client_ref: "tool-2" });
    const conflict = await thrownAsync(() => runToolWithContext(agentCtx, "create_comment", { work_item_id: item.id, body_md: "Two", client_ref: "tool-2" }));
    expect(conflict?.code).toBe("CONFLICT");
    const bad = await thrownAsync(() => runToolWithContext(agentCtx, "create_comment", { work_item_id: item.id, body_md: "Two", client_ref: "has space" }));
    expect(bad?.code).toBe("VALIDATION");
  });

  it("without a ref the tool behaves as before", async () => {
    const { agentCtx, item } = setup();
    const result = await runToolWithContext(agentCtx, "create_comment", { work_item_id: item.id, body_md: "Plain" });
    expect(view(result.data).client_ref).toBeNull();
  });
});
