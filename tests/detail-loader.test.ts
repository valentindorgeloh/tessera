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
import { createWorkItem } from "@/lib/tessera/work-items";
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
});
