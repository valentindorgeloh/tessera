/**
 * `listAgentConversations` (decision 152; src/lib/tessera/agent-conversations.ts): which work items an actor is in
 * a conversation on (assignee, item mention, live comment mention, extra id), what never qualifies, archived items,
 * the newest-first order with its 200 cap, and the last live comment per item.
 */
import { describe, expect, it } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createComment, deleteComment } from "@/lib/tessera/comments";
import { type TesseraContext } from "@/lib/tessera/core/context";
import { listAgentConversations } from "@/lib/tessera/agent-conversations";
import { archiveProject, createProject, deleteProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { archiveWorkItem, createWorkItem, deleteWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

function setup() {
  const ctx = createTestContext(createTestDb());
  const agent = registerActor(ctx, { kind: "agent", name: "mcp:superagent" });
  const web = createProject(ctx, { name: "Web", identifier: "WEB" });
  const api = createProject(ctx, { name: "Api", identifier: "API" });
  const mention = `[@mcp:superagent](actor:${agent.id})`;
  const item = (name: string, extra: { description_md?: string } = {}) => createWorkItem(ctx, { project_id: web.id, name, ...extra });
  const rows = (input: { project_ids?: string[]; extra_work_item_ids?: string[] } = {}) =>
    listAgentConversations(ctx, { actor_id: agent.id, project_ids: input.project_ids ?? [web.id], extra_work_item_ids: input.extra_work_item_ids });
  return { ctx, agent, web, api, mention, item, rows };
}

/** Sets a stored time directly, so an order test does not depend on the clock. */
function setUpdatedAt(ctx: TesseraContext, itemId: string, iso: string) {
  ctx.sqlite.prepare("UPDATE work_item SET updated_at = ? WHERE id = ?").run(iso, itemId);
}
function setCommentTime(ctx: TesseraContext, commentId: string, iso: string) {
  ctx.sqlite.prepare("UPDATE comment SET created_at = ? WHERE id = ?").run(iso, commentId);
}

describe("which items qualify", () => {
  it("lists an item the actor is assigned to", () => {
    const { ctx, agent, item, rows } = setup();
    const assigned = item("Assigned");
    item("Untouched");
    setAssignees(ctx, assigned.id, [agent.id]);
    expect(rows().map((row) => row.work_item_id)).toEqual([assigned.id]);
  });

  it("lists an item whose description mentions the actor", () => {
    const { mention, item, rows } = setup();
    const mentioned = item("Mentioned", { description_md: `Please look ${mention}` });
    item("Plain", { description_md: "Nothing here" });
    expect(rows().map((row) => row.work_item_id)).toEqual([mentioned.id]);
  });

  it("lists an item with a live comment that mentions the actor", () => {
    const { ctx, mention, item, rows } = setup();
    const thread = item("Thread");
    item("Quiet");
    createComment(ctx, thread.id, { body_md: `Hey ${mention}` });
    expect(rows().map((row) => row.work_item_id)).toEqual([thread.id]);
  });

  it("lists an extra id, and only once when it qualifies twice", () => {
    const { ctx, agent, item, rows } = setup();
    const extra = item("Extra");
    const both = item("Both");
    setAssignees(ctx, both.id, [agent.id]);
    item("Other");
    expect(rows({ extra_work_item_ids: [extra.id, both.id] }).map((row) => row.work_item_id).sort()).toEqual([extra.id, both.id].sort());
  });

  it("never lists an item whose only mention is on a deleted comment", () => {
    const { ctx, mention, item, rows } = setup();
    const thread = item("Thread");
    const note = createComment(ctx, thread.id, { body_md: `Hey ${mention}` });
    expect(rows()).toHaveLength(1);
    deleteComment(ctx, note.id);
    expect(rows()).toEqual([]);
  });

  it("never lists a deleted item or a draft", () => {
    const { ctx, agent, item, rows } = setup();
    const gone = item("Gone");
    setAssignees(ctx, gone.id, [agent.id]);
    deleteWorkItem(ctx, gone.id);
    // Drafts live in their own table; a `work_item.is_draft` row is the legacy flag the read still honours.
    const flagged = item("Flagged");
    setAssignees(ctx, flagged.id, [agent.id]);
    ctx.sqlite.prepare("UPDATE work_item SET is_draft = 1 WHERE id = ?").run(flagged.id);
    expect(rows({ extra_work_item_ids: [gone.id, flagged.id] })).toEqual([]);
  });

  it("never lists an item of a project outside project_ids, or of a deleted project", () => {
    const { ctx, agent, api, web, rows } = setup();
    const other = createWorkItem(ctx, { project_id: api.id, name: "Elsewhere" });
    setAssignees(ctx, other.id, [agent.id]);
    expect(rows({ project_ids: [web.id], extra_work_item_ids: [other.id] })).toEqual([]);
    expect(rows({ project_ids: [api.id] }).map((row) => row.work_item_id)).toEqual([other.id]);
    archiveProject(ctx, api.id);
    deleteProject(ctx, api.id);
    expect(rows({ project_ids: [api.id] })).toEqual([]);
  });

  it("includes archived items and the items of an archived project", () => {
    const { ctx, agent, api, item, rows } = setup();
    const old = item("Old");
    setAssignees(ctx, old.id, [agent.id]);
    const done = listStates(ctx, old.project_id).find((state) => state.state_group === "completed");
    updateWorkItem(ctx, old.id, { state_id: done?.id });
    archiveWorkItem(ctx, old.id);
    const inArchived = createWorkItem(ctx, { project_id: api.id, name: "In archived project" });
    setAssignees(ctx, inArchived.id, [agent.id]);
    archiveProject(ctx, api.id);
    const result = rows({ project_ids: [old.project_id, api.id] });
    expect(result.map((row) => [row.name, row.is_archived])).toEqual(expect.arrayContaining([["Old", true], ["In archived project", false]]));
  });

  it("returns nothing, with no query, for an empty project_ids", () => {
    const { item, rows } = setup();
    const extra = item("Extra");
    expect(rows({ project_ids: [], extra_work_item_ids: [extra.id] })).toEqual([]);
  });
});

describe("row content, order and cap", () => {
  it("fills key, names, the newest live comment and the later activity time", () => {
    const { ctx, agent, mention, item, web, rows } = setup();
    const thread = item("Thread");
    const first = createComment(ctx, thread.id, { body_md: `Start ${mention}` });
    const second = createComment(ctx, thread.id, { body_md: "**Newest** reply text" });
    const deleted = createComment(ctx, thread.id, { body_md: "Deleted last" });
    deleteComment(ctx, deleted.id);
    setUpdatedAt(ctx, thread.id, "2026-01-01T00:00:00.000Z");
    setCommentTime(ctx, first.id, "2026-02-01T00:00:00.000Z");
    setCommentTime(ctx, second.id, "2026-03-01T00:00:00.000Z");
    expect(rows()).toEqual([
      {
        work_item_id: thread.id,
        key: thread.key,
        name: "Thread",
        project_id: web.id,
        project_name: "Web",
        is_archived: false,
        last_comment: { actor_id: second.actor_id, actor_name: second.actor_name, snippet: "Newest reply text", created_at: "2026-03-01T00:00:00.000Z" },
        last_activity_at: "2026-03-01T00:00:00.000Z",
      },
    ]);
    expect(agent.id).not.toBe(second.actor_id);
  });

  it("has a null last comment when there is none, and the item's own update time", () => {
    const { ctx, agent, item, rows } = setup();
    const assigned = item("Assigned");
    setAssignees(ctx, assigned.id, [agent.id]);
    setUpdatedAt(ctx, assigned.id, "2026-04-01T00:00:00.000Z");
    expect(rows()[0]).toMatchObject({ last_comment: null, last_activity_at: "2026-04-01T00:00:00.000Z" });
  });

  it("orders by last activity, newest first, then by key", () => {
    const { ctx, item, rows } = setup();
    const a = item("A");
    const b = item("B");
    const c = item("C");
    const d = item("D");
    for (const entry of [a, b, c, d]) ctx.sqlite.prepare("UPDATE work_item SET updated_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", entry.id);
    setUpdatedAt(ctx, c.id, "2026-05-01T00:00:00.000Z");
    // b and d tie on a comment time that beats their own update time; keys break the tie, numerically.
    const note = createComment(ctx, d.id, { body_md: "later" });
    setCommentTime(ctx, note.id, "2026-06-01T00:00:00.000Z");
    const note2 = createComment(ctx, b.id, { body_md: "later" });
    setCommentTime(ctx, note2.id, "2026-06-01T00:00:00.000Z");
    expect(rows({ extra_work_item_ids: [a.id, b.id, c.id, d.id] }).map((row) => row.name)).toEqual(["B", "D", "C", "A"]);
  });

  it("returns at most 200 rows, keeping the newest", () => {
    const { ctx, item, rows } = setup();
    const created = Array.from({ length: 205 }, (_, index) => item(`Item ${index}`));
    created.forEach((entry, index) => setUpdatedAt(ctx, entry.id, `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.${String(Math.floor(index / 60)).padStart(3, "0")}Z`));
    const result = rows({ extra_work_item_ids: created.map((entry) => entry.id) });
    expect(result).toHaveLength(200);
    const kept = new Set(result.map((row) => row.work_item_id));
    const stamp = (id: string) => (ctx.sqlite.prepare("SELECT updated_at FROM work_item WHERE id = ?").get(id) as { updated_at: string }).updated_at;
    const dropped = created.filter((entry) => !kept.has(entry.id)).map((entry) => stamp(entry.id));
    const oldestKept = result.map((row) => row.last_activity_at).sort()[0];
    expect(dropped.every((at) => at <= oldestKept)).toBe(true);
  });
});
