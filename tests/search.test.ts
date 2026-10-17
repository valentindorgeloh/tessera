import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { upsertPageFts } from "@/lib/tessera/db/fts";
import { page } from "@/lib/tessera/db/schema";
import { archiveCycle, createCycle } from "@/lib/tessera/cycles";
import { archiveModule, createModule, updateModule } from "@/lib/tessera/modules";
import { archiveProject, createProject, updateProjectFeatures, type Project } from "@/lib/tessera/projects";
import { EXACT_NAME_SCORE, KEY_MATCH_SCORE, SEARCH_TYPES, searchAll, type SearchHit } from "@/lib/tessera/search";
import { listStates } from "@/lib/tessera/states";
import type { StateRow } from "@/lib/tessera/types";
import { createView, deleteView } from "@/lib/tessera/views";
import { archiveWorkItem, createWorkItem, deleteWorkItem, type WorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "./helpers/db";

const TODAY = "2026-10-10";

type Fixture = { handles: DbHandles; ctx: TesseraContext; project: Project; states: Record<string, StateRow> };

function setup(): Fixture {
  const handles = createTestDb();
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => TODAY });
  const p = createProject(ctx, { name: "Website", identifier: "WEB" });
  const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.state_group, s]));
  return { handles, ctx, project: p, states };
}

function item(ctx: TesseraContext, projectId: string, name: string, extra: { description_md?: string; state_id?: string } = {}): WorkItem {
  return createWorkItem(ctx, { project_id: projectId, name, ...extra });
}

function ids(hits: SearchHit[]): string[] {
  return hits.map((hit) => hit.id);
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

function insertPage(ctx: TesseraContext, projectId: string | null, name: string, body = "") {
  const now = ctx.now();
  const row = ctx.db
    .insert(page)
    .values({
      id: newId(),
      project_id: projectId,
      name,
      description_md: body,
      sort_order: firstSortOrder(),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning()
    .get();
  upsertPageFts(ctx.sqlite, { id: row.id, project_id: projectId, name, body });
  return row;
}

describe("searchAll over work items", () => {
  it("finds items by word stem in the name and in the description", () => {
    const { ctx, project } = setup();
    const a = item(ctx, project.id, "Optimizing image loading");
    const b = item(ctx, project.id, "Footer", { description_md: "The optimized footer renders images lazily." });
    item(ctx, project.id, "Unrelated");
    expect(ids(searchAll(ctx, "optimize")).sort()).toEqual([a.id, b.id].sort());
    expect(ids(searchAll(ctx, "images")).sort()).toEqual([a.id, b.id].sort());
    expect(searchAll(ctx, "nothing-like-this")).toEqual([]);
  });

  it("returns the hit shape with key, project, subtitle and score", () => {
    const { ctx, project } = setup();
    const created = item(ctx, project.id, "Deploy the site");
    const [hit] = searchAll(ctx, "deploy");
    expect(hit).toEqual({
      type: "work_item",
      id: created.id,
      project_id: project.id,
      key: created.key,
      title: "Deploy the site",
      subtitle: "Website · Backlog",
      score: expect.any(Number),
    });
  });

  it("ranks an exact key first, above full-text hits that match the same words", () => {
    const { ctx, project } = setup();
    item(ctx, project.id, "Web 3 launch notes");
    item(ctx, project.id, "Web 3 follow-up");
    const third = item(ctx, project.id, "Third item");
    expect(third.key).toBe("WEB-3");
    const hits = searchAll(ctx, "WEB-3");
    expect(hits[0].id).toBe(third.id);
    expect(hits[0].score).toBe(KEY_MATCH_SCORE);
    expect(hits.length).toBeGreaterThan(1);
    expect(ids(searchAll(ctx, " web-3 "))[0]).toBe(third.id);
    expect(ids(searchAll(ctx, "WEB-99"))).toEqual([]);
  });

  it("ranks an exact name above partial full-text matches", () => {
    const { ctx, project } = setup();
    const long = item(ctx, project.id, "Login form submits twice on Enter");
    const exact = item(ctx, project.id, "login");
    const hits = searchAll(ctx, "Login");
    expect(ids(hits)).toEqual([exact.id, long.id]);
    expect(hits[0].score).toBe(EXACT_NAME_SCORE);
  });

  it("never returns deleted items", () => {
    const { ctx, project } = setup();
    const gone = item(ctx, project.id, "Deleted thing");
    const kept = item(ctx, project.id, "Kept thing");
    deleteWorkItem(ctx, gone.id);
    expect(ids(searchAll(ctx, "thing"))).toEqual([kept.id]);
    expect(ids(searchAll(ctx, "thing", { include_archived: true }))).toEqual([kept.id]);
  });

  it("hides archived items unless include_archived is set", () => {
    const { ctx, project, states } = setup();
    const done = item(ctx, project.id, "Archived report", { state_id: states.completed.id });
    const open = item(ctx, project.id, "Open report");
    archiveWorkItem(ctx, done.id);
    expect(ids(searchAll(ctx, "report"))).toEqual([open.id]);
    expect(ids(searchAll(ctx, "report", { include_archived: true })).sort()).toEqual([done.id, open.id].sort());
    expect(ids(searchAll(ctx, done.key))).toEqual([]);
    expect(ids(searchAll(ctx, done.key, { include_archived: true }))).toEqual([done.id]);
  });

  it("hides items of archived projects unless include_archived is set", () => {
    const { ctx, project } = setup();
    const old = createProject(ctx, { name: "Old", identifier: "OLD" });
    const kept = item(ctx, project.id, "Shared word");
    const lost = item(ctx, old.id, "Shared word too");
    archiveProject(ctx, old.id);
    expect(ids(searchAll(ctx, "shared"))).toEqual([kept.id]);
    expect(ids(searchAll(ctx, "shared", { include_archived: true })).sort()).toEqual([kept.id, lost.id].sort());
  });

  it("hides items waiting in the hidden triage state", () => {
    const { handles } = setup();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => TODAY });
    const p = createProject(ctx, { name: "Intake", identifier: "INT", features: { intake_enabled: true, agent_intake_required: true } });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:test" });
    const agentCtx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id, today: () => TODAY });
    const pending = createWorkItem(agentCtx, { project_id: p.id, name: "Pending request" });
    const visible = createWorkItem(ctx, { project_id: p.id, name: "Visible request" });
    expect(ids(searchAll(ctx, "request"))).toEqual([visible.id]);
    expect(ids(searchAll(ctx, pending.key))).toEqual([]);
  });

  it("respects the project scope for items, cycles and modules", () => {
    const { ctx, project } = setup();
    const other = createProject(ctx, { name: "Mobile", identifier: "MOB" });
    const mine = item(ctx, project.id, "Invoice export");
    item(ctx, other.id, "Invoice import");
    createCycle(ctx, { project_id: project.id, name: "Invoice sprint" });
    createCycle(ctx, { project_id: other.id, name: "Invoice sprint" });
    createModule(ctx, { project_id: project.id, name: "Invoice flow" });
    createModule(ctx, { project_id: other.id, name: "Invoice flow" });
    const scoped = searchAll(ctx, "invoice", { scope: { project_id: project.id } });
    expect(scoped.every((hit) => hit.project_id === project.id)).toBe(true);
    expect(scoped.map((hit) => hit.type).sort()).toEqual(["cycle", "module", "work_item"]);
    expect(scoped.find((hit) => hit.type === "work_item")?.id).toBe(mine.id);
    expect(searchAll(ctx, "invoice").filter((hit) => hit.type === "work_item")).toHaveLength(2);
    expect(ids(searchAll(ctx, mine.key, { scope: { project_id: other.id } }))).toEqual([]);
  });
});

describe("searchAll over cycles, modules and projects", () => {
  it("matches names case-insensitively anywhere in the name", () => {
    const { ctx, project } = setup();
    const cycle = createCycle(ctx, { project_id: project.id, name: "Sprint 12" });
    const mod = createModule(ctx, { project_id: project.id, name: "Marketing Site" });
    const hits = searchAll(ctx, "SPRINT");
    expect(hits).toEqual([{ type: "cycle", id: cycle.id, project_id: project.id, title: "Sprint 12", subtitle: "Website", score: expect.any(Number) }]);
    expect(ids(searchAll(ctx, "keting"))).toEqual([mod.id]);
    expect(ids(searchAll(ctx, "site", { types: ["module"] }))).toEqual([mod.id]);
  });

  it("finds projects by name or identifier and labels the hit with the identifier", () => {
    const { ctx, project } = setup();
    const byName = searchAll(ctx, "website", { types: ["project"] });
    expect(byName).toEqual([{ type: "project", id: project.id, project_id: project.id, key: "WEB", title: "Website", subtitle: "WEB", score: expect.any(Number) }]);
    expect(ids(searchAll(ctx, "web", { types: ["project"] }))).toEqual([project.id]);
    expect(searchAll(ctx, "WEB")[0].score).toBe(EXACT_NAME_SCORE);
  });

  it("hides archived cycles, modules and projects unless asked", () => {
    const { ctx, project } = setup();
    const ended = createCycle(ctx, { project_id: project.id, name: "Old sprint", start_date: "2026-01-01", end_date: "2026-01-14" });
    archiveCycle(ctx, ended.id);
    const mod = createModule(ctx, { project_id: project.id, name: "Old module", status: "completed" });
    archiveModule(ctx, mod.id);
    const old = createProject(ctx, { name: "Old project", identifier: "OLD" });
    archiveProject(ctx, old.id);
    expect(searchAll(ctx, "old")).toEqual([]);
    expect(ids(searchAll(ctx, "old", { include_archived: true })).sort()).toEqual([ended.id, mod.id, old.id].sort());
  });

  it("treats % and _ in the query as literal characters", () => {
    const { ctx, project } = setup();
    createModule(ctx, { project_id: project.id, name: "Plain module" });
    const percent = createModule(ctx, { project_id: project.id, name: "100% coverage" });
    const underscore = createCycle(ctx, { project_id: project.id, name: "snake_case" });
    expect(ids(searchAll(ctx, "%", { types: ["module", "cycle"] }))).toEqual([percent.id]);
    expect(ids(searchAll(ctx, "e_c", { types: ["module", "cycle"] }))).toEqual([underscore.id]);
    expect(ids(searchAll(ctx, "100%"))).toEqual([percent.id]);
  });

  it("never returns deleted cycles or modules", () => {
    const { ctx, project } = setup();
    const mod = createModule(ctx, { project_id: project.id, name: "Doomed" });
    updateModule(ctx, mod.id, { status: "cancelled" });
    const before = ids(searchAll(ctx, "doomed"));
    expect(before).toEqual([mod.id]);
    ctx.sqlite.prepare("UPDATE module SET deleted_at = ? WHERE id = ?").run(ctx.now(), mod.id);
    expect(searchAll(ctx, "doomed")).toEqual([]);
  });
});

describe("searchAll over views", () => {
  it("search_all finds views", () => {
    const { ctx, project } = setup();
    const mine = createView(ctx, { project_id: project.id, name: "Roadmap" });
    const shared = createView(ctx, { project_id: null, name: "Roadmap overview" });
    const gone = createView(ctx, { project_id: project.id, name: "Roadmap old" });
    deleteView(ctx, gone.id);
    const archivedProject = createProject(ctx, { name: "Archive", identifier: "ARC" });
    createView(ctx, { project_id: archivedProject.id, name: "Roadmap archived" });
    archiveProject(ctx, archivedProject.id);
    const off = createProject(ctx, { name: "Quiet", identifier: "QUI" });
    createView(ctx, { project_id: off.id, name: "Roadmap quiet" });
    updateProjectFeatures(ctx, off.id, { views_enabled: false });
    const hits = searchAll(ctx, "roadmap", { types: ["view"] });
    expect(ids(hits).sort()).toEqual([mine.id, shared.id].sort());
    expect(hits.find((hit) => hit.id === mine.id)).toMatchObject({ type: "view", project_id: project.id, title: "Roadmap" });
    expect(hits.find((hit) => hit.id === shared.id)).toMatchObject({ type: "view", project_id: null, title: "Roadmap overview" });
    expect(hits[0].id).toBe(mine.id);
    expect(ids(searchAll(ctx, "roadmap", { types: ["view"], scope: { project_id: project.id } }))).toEqual([mine.id]);
    expect(ids(searchAll(ctx, "roadmap")).sort()).toEqual([mine.id, shared.id].sort());
  });
});

describe("searchAll with cycles or modules off (decision 31)", () => {
  it("omits cycle hits of a project with cycles off and module hits of one with modules off, scoped or not", () => {
    const { ctx, project } = setup();
    const liveCycle = createCycle(ctx, { project_id: project.id, name: "Sprint live" });
    const liveModule = createModule(ctx, { project_id: project.id, name: "Sprint module live" });
    const quiet = createProject(ctx, { name: "Quiet", identifier: "QUI" });
    createCycle(ctx, { project_id: quiet.id, name: "Sprint quiet" });
    createModule(ctx, { project_id: quiet.id, name: "Sprint module quiet" });
    updateProjectFeatures(ctx, quiet.id, { cycles_enabled: false });
    expect(ids(searchAll(ctx, "sprint", { types: ["cycle"] }))).toEqual([liveCycle.id]);
    expect(ids(searchAll(ctx, "sprint", { types: ["module"] })).length).toBe(2);
    updateProjectFeatures(ctx, quiet.id, { cycles_enabled: true, modules_enabled: false });
    expect(ids(searchAll(ctx, "sprint", { types: ["cycle"] })).length).toBe(2);
    expect(ids(searchAll(ctx, "sprint", { types: ["module"] }))).toEqual([liveModule.id]);
    expect(searchAll(ctx, "sprint", { types: ["module"], scope: { project_id: quiet.id } })).toEqual([]);
    expect(ids(searchAll(ctx, "sprint", { types: ["cycle"], scope: { project_id: quiet.id } })).length).toBe(1);
    updateProjectFeatures(ctx, quiet.id, { cycles_enabled: false, modules_enabled: false });
    expect(searchAll(ctx, "sprint", { scope: { project_id: quiet.id } })).toEqual([]);
    expect(ids(searchAll(ctx, "sprint")).sort()).toEqual([liveCycle.id, liveModule.id].sort());
  });
});

describe("searchAll over pages", () => {
  it("finds project pages and wiki pages through the page FTS table", () => {
    const { ctx, project } = setup();
    const projectPage = insertPage(ctx, project.id, "Release checklist", "Steps before shipping.");
    const wiki = insertPage(ctx, null, "Shipping guide");
    const hits = searchAll(ctx, "ship", { types: ["page"] });
    expect(ids(hits).sort()).toEqual([projectPage.id, wiki.id].sort());
    expect(hits.find((hit) => hit.id === wiki.id)).toEqual({ type: "page", id: wiki.id, project_id: null, title: "Shipping guide", subtitle: "Wiki", score: expect.any(Number) });
    expect(hits.find((hit) => hit.id === projectPage.id)?.subtitle).toBe("Website");
    expect(ids(searchAll(ctx, "ship", { types: ["page"], scope: { project_id: project.id } }))).toEqual([projectPage.id]);
  });

  it("hides deleted and archived pages", () => {
    const { ctx, project } = setup();
    const deleted = insertPage(ctx, project.id, "Deleted notes");
    const archived = insertPage(ctx, project.id, "Archived notes");
    const live = insertPage(ctx, project.id, "Live notes");
    ctx.sqlite.prepare("UPDATE page SET deleted_at = ? WHERE id = ?").run(ctx.now(), deleted.id);
    ctx.sqlite.prepare("UPDATE page SET archived_at = ? WHERE id = ?").run(ctx.now(), archived.id);
    expect(ids(searchAll(ctx, "notes"))).toEqual([live.id]);
    expect(ids(searchAll(ctx, "notes", { include_archived: true })).sort()).toEqual([archived.id, live.id].sort());
  });
});

describe("searchAll options", () => {
  it("returns nothing for a blank query", () => {
    const { ctx, project } = setup();
    item(ctx, project.id, "Anything");
    expect(searchAll(ctx, "")).toEqual([]);
    expect(searchAll(ctx, "   ")).toEqual([]);
  });

  it("limits the merged result and searches every type by default", () => {
    const { ctx, project } = setup();
    for (let i = 0; i < 5; i += 1) item(ctx, project.id, `Common word ${i}`);
    createCycle(ctx, { project_id: project.id, name: "Common cycle" });
    createModule(ctx, { project_id: project.id, name: "Common module" });
    insertPage(ctx, project.id, "Common page");
    const all = searchAll(ctx, "common", { limit: 50 });
    expect(new Set(all.map((hit) => hit.type))).toEqual(new Set(["work_item", "cycle", "module", "page"]));
    expect(all).toHaveLength(8);
    expect(searchAll(ctx, "common", { limit: 3 })).toHaveLength(3);
    expect(SEARCH_TYPES).toEqual(["work_item", "page", "cycle", "module", "project", "view"]);
  });

  it("orders hits by score, then type order, then title", () => {
    const { ctx, project } = setup();
    const mod = createModule(ctx, { project_id: project.id, name: "Alpha" });
    const cycle = createCycle(ctx, { project_id: project.id, name: "Alpha" });
    const workItem = item(ctx, project.id, "Alpha");
    expect(ids(searchAll(ctx, "alpha"))).toEqual([workItem.id, cycle.id, mod.id]);
    const b = item(ctx, project.id, "Beta two");
    const a = item(ctx, project.id, "Beta one");
    const scores = searchAll(ctx, "beta").map((hit) => hit.score);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    expect(ids(searchAll(ctx, "beta")).sort()).toEqual([a.id, b.id].sort());
  });

  it("VALIDATION for a bad limit, an unknown type or a malformed scope", () => {
    const { ctx } = setup();
    expect(errorCode(() => searchAll(ctx, "x", { limit: 0 }))).toBe("VALIDATION");
    expect(errorCode(() => searchAll(ctx, "x", { types: ["comment"] as never }))).toBe("VALIDATION");
    expect(errorCode(() => searchAll(ctx, "x", { scope: { project_id: "nope" } }))).toBe("VALIDATION");
    expect(errorCode(() => searchAll(ctx, "x", { types: [] }))).toBe("VALIDATION");
  });
});
