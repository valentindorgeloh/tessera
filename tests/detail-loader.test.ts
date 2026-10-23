/**
 * `loadWorkItemDetail` (src/app/(tessera)/work-items/load-detail.ts) fills the
 * pieces the detail renders from the engine: the comment threads for the
 * activity timeline (decision 56) and the pages that embed the item for the
 * "Mentioned in" section (decision 44, docs/PLAN.md section 12 step 7).
 * `@/lib/tessera/server` is replaced by the engine barrel (the real module's
 * "server-only" guard throws under plain Node).
 */
import { describe, expect, it, vi } from "vitest";
import { createComment } from "@/lib/tessera/comments";
import { archivePage, createPage } from "@/lib/tessera/pages";
import { createProject } from "@/lib/tessera/projects";
import { addReaction } from "@/lib/tessera/reactions";
import { addRelation } from "@/lib/tessera/relations";
import { listStates } from "@/lib/tessera/states";
import { archiveWorkItem, createWorkItem, deleteWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

vi.mock("@/lib/tessera/server", async () => vi.importActual<typeof import("@/lib/tessera")>("@/lib/tessera"));

const { loadWorkItemDetail } = await import("@/app/(tessera)/work-items/load-detail");

function setup() {
  const ctx = createTestContext(createTestDb());
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
  return { ctx, project, item };
}

describe("loadWorkItemDetail", () => {
  it("returns no comments and no backlinks for a fresh item", () => {
    const { ctx, item } = setup();
    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.comments).toEqual([]);
    expect(data.backlinks).toEqual([]);
  });

  it("returns the comment threads, replies nested under their root", () => {
    const { ctx, item } = setup();
    const root = createComment(ctx, item.id, { body_md: "Root" });
    const reply = createComment(ctx, item.id, { body_md: "Reply", parent_comment_id: root.id });
    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.comments?.map((row) => row.id)).toEqual([root.id]);
    expect(data.comments?.[0]?.replies.map((row) => row.id)).toEqual([reply.id]);
    expect(data.comments?.[0]?.actor_name).toBeTruthy();
  });

  it("lists the pages that embed the item and keeps an archived page, flagged", () => {
    const { ctx, project, item } = setup();
    const page = createPage(ctx, { project_id: project.id, name: "Launch notes", description_md: `See [${item.key}](work:${item.key})` });
    const other = createPage(ctx, { project_id: project.id, name: "Unrelated", description_md: "Nothing here" });
    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.backlinks?.map((row) => row.id)).toEqual([page.id]);
    expect(data.backlinks?.[0]?.archived_at).toBeNull();
    expect(data.backlinks?.some((row) => row.id === other.id)).toBe(false);

    archivePage(ctx, page.id);
    const afterArchive = loadWorkItemDetail(ctx, item.id);
    expect(afterArchive.backlinks?.map((row) => row.id)).toEqual([page.id]);
    expect(afterArchive.backlinks?.[0]?.archived_at).not.toBeNull();
  });

  it("returns no relations and no reactions for a fresh item", () => {
    const { ctx, item } = setup();
    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.relations).toEqual([]);
    expect(data.reactions).toEqual([]);
  });

  it("returns the relations from the open item's side with the other item resolved, across projects (decision 55)", () => {
    const { ctx, item } = setup();
    const ops = createProject(ctx, { name: "Ops", identifier: "OPS" });
    const blocker = createWorkItem(ctx, { project_id: ops.id, name: "Rotate keys" });
    const sibling = createWorkItem(ctx, { project_id: item.project_id, name: "Signup" });
    addRelation(ctx, { work_item_id: item.id, related_work_item_id: blocker.id, relation_type: "blocked_by" });
    addRelation(ctx, { work_item_id: item.id, related_work_item_id: sibling.id, relation_type: "relates_to" });

    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.relations?.map((row) => [row.relation_type, row.item.key, row.item.name, row.item.project_id, row.item.archived])).toEqual([
      ["blocked_by", blocker.key, "Rotate keys", ops.id, false],
      ["relates_to", sibling.key, "Signup", item.project_id, false],
    ]);
    expect(data.relations?.[0]?.item.state).toMatchObject({ name: expect.any(String), state_group: expect.any(String) });

    // The other side sees the inverse.
    const inverse = loadWorkItemDetail(ctx, blocker.id);
    expect(inverse.relations?.map((row) => [row.relation_type, row.item.key])).toEqual([["blocking", item.key]]);
  });

  it("keeps an archived related item, marked, and leaves out one that was deleted", () => {
    const { ctx, item } = setup();
    const archivedOne = createWorkItem(ctx, { project_id: item.project_id, name: "Old" });
    const goneOne = createWorkItem(ctx, { project_id: item.project_id, name: "Gone" });
    addRelation(ctx, { work_item_id: item.id, related_work_item_id: archivedOne.id, relation_type: "duplicate" });
    addRelation(ctx, { work_item_id: item.id, related_work_item_id: goneOne.id, relation_type: "relates_to" });
    // Only a completed or cancelled item can be archived.
    const done = listStates(ctx, item.project_id).find((state) => state.state_group === "completed");
    updateWorkItem(ctx, archivedOne.id, { state_id: done?.id });
    archiveWorkItem(ctx, archivedOne.id);
    deleteWorkItem(ctx, goneOne.id);

    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.relations?.map((row) => [row.item.key, row.item.archived])).toEqual([[archivedOne.key, true]]);
  });

  it("returns the reactions under the description and on each comment (decision 57)", () => {
    const { ctx, item } = setup();
    const note = createComment(ctx, item.id, { body_md: "Nice" });
    addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "👍" });
    addReaction(ctx, { target: "work_item", target_id: item.id, reaction: "🚀" });
    addReaction(ctx, { target: "comment", target_id: note.id, reaction: "🎉" });

    const data = loadWorkItemDetail(ctx, item.id);
    expect(data.reactions?.map((entry) => [entry.reaction, entry.count])).toEqual([["👍", 1], ["🚀", 1]]);
    expect(data.reactions?.[0]?.actor_ids).toEqual([ctx.actor.id]);
    expect(data.comments?.[0]?.reactions.map((entry) => entry.reaction)).toEqual(["🎉"]);
  });
});
