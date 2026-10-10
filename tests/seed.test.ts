import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { getCycle, listCycles } from "@/lib/tessera/cycles";
import { activity } from "@/lib/tessera/db/schema";
import { listLabels } from "@/lib/tessera/labels";
import { getModule, listModules } from "@/lib/tessera/modules";
import { getProject, listProjects } from "@/lib/tessera/projects";
import { PrioritySchema } from "@/lib/tessera/schemas";
import { searchAll } from "@/lib/tessera/search";
import { DEMO_PROJECT, SEED_SUMMARY, seedDemo } from "@/lib/tessera/seed";
import { listStates } from "@/lib/tessera/states";
import { getView, listViews } from "@/lib/tessera/views";
import { getWorkItem, listChildren, listWorkItems, type WorkItem } from "@/lib/tessera/work-items";
import { createTestDb } from "./helpers/db";

const TODAY = "2026-10-10";

function setup(): TesseraContext {
  const handles = createTestDb();
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => TODAY });
}

function seededItems(ctx: TesseraContext, projectId: string): WorkItem[] {
  return listWorkItems(ctx, { scope: { type: "project", project_id: projectId } }).items;
}

function activityCount(ctx: TesseraContext): number {
  return ctx.db.select({ n: count() }).from(activity).get()?.n ?? 0;
}

describe("seedDemo", () => {
  it("creates the WEB project with exactly what SEED_SUMMARY describes", () => {
    const ctx = setup();
    const result = seedDemo(ctx);
    expect(result.created).toBe(true);
    expect(result.project.identifier).toBe(DEMO_PROJECT.identifier);
    expect(result.project.name).toBe(DEMO_PROJECT.name);
    expect(SEED_SUMMARY.project).toEqual(DEMO_PROJECT);
    expect(listLabels(ctx, result.project.id)).toHaveLength(SEED_SUMMARY.labels);
    expect(seededItems(ctx, result.project.id)).toHaveLength(SEED_SUMMARY.work_items);
    expect(listCycles(ctx, result.project.id)).toHaveLength(SEED_SUMMARY.cycles);
    expect(listModules(ctx, result.project.id)).toHaveLength(SEED_SUMMARY.modules);
    expect(listViews(ctx, { project_id: result.project.id }).length + listViews(ctx, { project_id: null }).length).toBe(SEED_SUMMARY.views);
    expect(SEED_SUMMARY.work_items).toBe(40);
    expect(SEED_SUMMARY.labels).toBe(6);
    expect(SEED_SUMMARY.child_labels).toBe(2);
  });

  it("is idempotent: a second call returns the existing project and writes nothing", () => {
    const ctx = setup();
    const first = seedDemo(ctx);
    const rowsAfterFirst = activityCount(ctx);
    const second = seedDemo(ctx);
    expect(second.created).toBe(false);
    expect(second.project.id).toBe(first.project.id);
    expect(activityCount(ctx)).toBe(rowsAfterFirst);
    expect(listProjects(ctx)).toHaveLength(1);
    expect(seededItems(ctx, first.project.id)).toHaveLength(SEED_SUMMARY.work_items);
    expect(listLabels(ctx, first.project.id)).toHaveLength(SEED_SUMMARY.labels);
  });

  it("returns the project counts through the service view model", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const read = getProject(ctx, "web");
    expect(read.id).toBe(project.id);
    expect(read.counts.total).toBe(SEED_SUMMARY.work_items);
    expect(read.logo).toEqual({ icon: "Globe", color: "blue" });
  });

  it("seeds six labels, two of them children of top-level labels", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const labels = listLabels(ctx, project.id);
    const byName = new Map(labels.map((label) => [label.name, label]));
    const children = labels.filter((label) => label.parent_id !== null);
    expect(children).toHaveLength(2);
    expect(byName.get("Accessibility")?.parent_id).toBe(byName.get("Frontend")?.id);
    expect(byName.get("API")?.parent_id).toBe(byName.get("Backend")?.id);
    for (const child of children) {
      const parent = labels.find((label) => label.id === child.parent_id);
      expect(parent?.parent_id).toBeNull();
    }
  });

  it("every seeded work item re-reads through getWorkItem with a WEB key and project-owned references", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const stateIds = new Set(listStates(ctx, project.id).map((state) => state.id));
    const labelIds = new Set(listLabels(ctx, project.id).map((label) => label.id));
    const moduleIds = new Set(listModules(ctx, project.id).map((module) => module.id));
    const cycleIds = new Set(listCycles(ctx, project.id).map((cycle) => cycle.id));
    const items = seededItems(ctx, project.id);
    for (const listed of items) {
      const item = getWorkItem(ctx, listed.id);
      expect(item.key).toBe(`WEB-${item.sequence_id}`);
      expect(stateIds.has(item.state_id)).toBe(true);
      for (const labelId of item.label_ids) expect(labelIds.has(labelId)).toBe(true);
      for (const moduleId of item.module_ids) expect(moduleIds.has(moduleId)).toBe(true);
      if (item.cycle_id !== null) expect(cycleIds.has(item.cycle_id)).toBe(true);
      if (item.start_date !== null && item.target_date !== null) expect(item.start_date <= item.target_date).toBe(true);
      expect(item.subscriber_ids).toContain(item.created_by);
    }
    const keys = items.map((item) => item.sequence_id).sort((a, b) => a - b);
    expect(keys).toEqual(Array.from({ length: SEED_SUMMARY.work_items }, (_, i) => i + 1));
  });

  it("spreads items across every state, every priority, both assignees, parents, dates and descriptions", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const items = seededItems(ctx, project.id);
    const groupOf = new Map(listStates(ctx, project.id).map((state) => [state.id, state.state_group]));
    const groups = new Set(items.map((item) => groupOf.get(item.state_id)));
    expect([...groups].sort()).toEqual(["backlog", "cancelled", "completed", "started", "unstarted"]);
    expect(new Set(items.map((item) => item.priority))).toEqual(new Set(PrioritySchema.options));
    const assignees = new Set(items.flatMap((item) => item.assignee_ids));
    expect(assignees.has(USER_ACTOR_ID)).toBe(true);
    expect(assignees.has(ASSISTANT_ACTOR_ID)).toBe(true);
    expect(items.some((item) => item.assignee_ids.length === 2)).toBe(true);
    expect(items.some((item) => item.assignee_ids.length === 0)).toBe(true);
    expect(items.filter((item) => item.parent_id !== null).length).toBeGreaterThanOrEqual(8);
    expect(items.filter((item) => item.target_date !== null).length).toBeGreaterThanOrEqual(15);
    expect(items.filter((item) => item.start_date !== null).length).toBeGreaterThanOrEqual(8);
    expect(items.filter((item) => item.description_md !== "").length).toBeGreaterThanOrEqual(5);
    expect(items.filter((item) => item.label_ids.length > 0).length).toBeGreaterThanOrEqual(35);
    expect(new Set(items.map((item) => item.created_by))).toEqual(new Set([USER_ACTOR_ID, ASSISTANT_ACTOR_ID]));
    const completed = items.filter((item) => groupOf.get(item.state_id) === "completed");
    for (const item of completed) expect(item.completed_at).not.toBeNull();
  });

  it("parents list their children and children never have a cycle their parent could not join", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const items = seededItems(ctx, project.id);
    const parents = items.filter((item) => item.sub_items_count > 0);
    expect(parents.length).toBeGreaterThanOrEqual(3);
    for (const parent of parents) {
      const children = listChildren(ctx, parent.id);
      expect(children).toHaveLength(parent.sub_items_count);
      for (const child of children) {
        expect(child.parent_id).toBe(parent.id);
        expect(child.project_id).toBe(project.id);
      }
    }
  });

  it("seeds one current and one upcoming cycle that both hold items", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const cycles = listCycles(ctx, project.id);
    expect(cycles.map((cycle) => cycle.status).sort()).toEqual(["current", "upcoming"]);
    for (const cycle of cycles) {
      const detail = getCycle(ctx, cycle.id);
      expect(detail.progress.total).toBeGreaterThan(0);
      expect(detail.start_date).not.toBeNull();
      expect(detail.end_date).not.toBeNull();
      if (cycle.status === "current") {
        expect(detail.start_date !== null && detail.start_date <= TODAY).toBe(true);
        expect(detail.end_date !== null && detail.end_date >= TODAY).toBe(true);
      } else {
        expect(detail.start_date !== null && detail.start_date > TODAY).toBe(true);
      }
    }
  });

  it("seeds two modules with members, items and one link", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const modules = listModules(ctx, project.id);
    let links = 0;
    for (const listed of modules) {
      const mod = getModule(ctx, listed.id);
      expect(mod.member_ids.length).toBeGreaterThan(0);
      expect(mod.work_item_ids.length).toBeGreaterThan(0);
      expect(mod.progress.total).toBe(mod.work_item_ids.length);
      expect(mod.lead_actor_id).not.toBeNull();
      links += mod.links.length;
    }
    expect(links).toBe(SEED_SUMMARY.module_links);
    expect(modules.map((module) => module.status).sort()).toEqual(["in_progress", "planned"]);
  });

  it("seeds a project view on the Bug label and a table-only workspace view", () => {
    const ctx = setup();
    const { project } = seedDemo(ctx);
    const bug = listLabels(ctx, project.id).find((label) => label.name === "Bug");
    const [projectView] = listViews(ctx, { project_id: project.id });
    const [workspaceView] = listViews(ctx, { project_id: null });
    expect(getView(ctx, projectView.id).filters.labels).toEqual([bug?.id]);
    expect(getView(ctx, projectView.id).display.group_by).toBe("state");
    expect(getView(ctx, workspaceView.id).project_id).toBeNull();
    expect(getView(ctx, workspaceView.id).display.layout).toBe("table");
    expect(getView(ctx, workspaceView.id).filters.priority).toEqual(["urgent", "high"]);
    const bugs = listWorkItems(ctx, { scope: { type: "view", view_id: projectView.id } });
    expect(bugs.total).toBeGreaterThan(0);
    for (const item of bugs.items) expect(item.label_ids).toContain(bug?.id);
  });

  it("writes FTS rows so seeded items and modules are searchable", () => {
    const ctx = setup();
    seedDemo(ctx);
    const hits = searchAll(ctx, "checkout");
    expect(hits.some((hit) => hit.type === "work_item")).toBe(true);
    expect(hits.some((hit) => hit.type === "module" && hit.title === "Checkout")).toBe(true);
  });
});
