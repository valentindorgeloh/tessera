// @vitest-environment jsdom
/**
 * The lean row context (src/components/work-items/project-provider.tsx `useProjectRow`, decision 141): what a
 * list row and its property controls read of the project bundle. It keeps its identity across a refresh that only
 * moved the cursor, the counts, a cycle's progress, a module's members or an actor's `last_seen_at`; it changes when
 * a state is renamed or a label is added; the full context (`useProject`) still carries every field; and tsc rejects
 * a read of a stripped field.
 */
import { act, createElement, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProjectProvider, ProjectScope, toRowBundle, useProject, useProjectRow, type ProjectContextValue, type ProjectRowContextValue } from "@/components/work-items/project-provider";
import { shareStructure } from "@/components/work-items/stable";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Cycle, Label, Module, Project, State } from "@/lib/tessera/types";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE = "66666666-6666-7666-8666-666666666666";
const CYCLE = "77777777-7777-7777-8777-777777777777";
const MODULE = "88888888-8888-7888-8888-888888888888";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

function makeBundle(): ProjectBundle {
  const project = {
    id: PROJECT,
    name: "Website",
    identifier: "WEB",
    next_sequence: 4,
    cycles_enabled: true,
    modules_enabled: true,
    estimates_enabled: false,
    archived_at: null,
    counts: { total: 3, by_state_group: { backlog: 3, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 } },
    ...audit,
  } as unknown as Project;
  const states = [{ id: STATE, project_id: PROJECT, name: "Todo", state_group: "unstarted", is_default: true, ...audit }] as unknown as State[];
  const labels = [{ id: "label-1", project_id: PROJECT, name: "Bug", color: "red", ...audit }] as unknown as Label[];
  const cycles = [{ id: CYCLE, name: "Sprint 1", status: "current", archived_at: null, progress: { total: 3, completed: 1, cancelled: 0 }, open_count: 2, ...audit }] as unknown as Cycle[];
  const modules = [{ id: MODULE, name: "Importer", archived_at: null, member_ids: ["a"], links_count: 0, progress: { total: 1 }, ...audit }] as unknown as Module[];
  const actors = [{ id: USER, kind: "user", name: "Valentin", color: "blue", last_seen_at: null, ...audit }] as unknown as ActorRow[];
  return { project, states, labels, cycles, modules, actors, cursor: 10, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] };
}

const clone = (bundle: ProjectBundle): ProjectBundle => JSON.parse(JSON.stringify(bundle)) as ProjectBundle;

/** The bundle after a work item write elsewhere: everything a write moves without a row drawing it. */
function afterWrite(bundle: ProjectBundle): ProjectBundle {
  const next = clone(bundle);
  next.cursor += 5;
  next.intake_open = 2;
  next.project.counts.total += 1;
  next.project.next_sequence += 1;
  next.project.updated_at = "2026-10-12T10:00:00.000Z";
  next.cycles[0]!.progress = { total: 4, completed: 2, cancelled: 0 };
  next.cycles[0]!.open_count = 1;
  next.modules[0]!.member_ids = ["a", "b"];
  next.modules[0]!.links_count = 3;
  next.actors[0]!.last_seen_at = "2026-10-12T10:00:00.000Z";
  next.actors[0]!.updated_at = "2026-10-12T10:00:00.000Z";
  return next;
}

const seen: { row: ProjectRowContextValue[]; full: ProjectContextValue[] } = { row: [], full: [] };
let root: Root | null = null;

function Probe() {
  const row = useProjectRow();
  const full = useProject();
  useEffect(() => {
    seen.row.push(row);
    seen.full.push(full);
  });
  return null;
}

function render(Provider: typeof ProjectProvider | typeof ProjectScope, bundle: ProjectBundle) {
  return act(async () => {
    root ??= createRoot(document.createElement("div"));
    root.render(createElement(Provider, { bundle } as ComponentProps<typeof ProjectProvider>, createElement(Probe)));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  const current = root;
  root = null;
  seen.row = [];
  seen.full = [];
  if (current)
    await act(async () => {
      current.unmount();
    });
});

describe("toRowBundle", () => {
  it("drops the fields a write moves and keeps the ones a row draws", () => {
    const lean = toRowBundle(makeBundle());
    expect(lean.cycles[0]).toMatchObject({ id: CYCLE, name: "Sprint 1", status: "current", archived_at: null });
    expect(lean.cycles[0]).not.toHaveProperty("progress");
    expect(lean.cycles[0]).not.toHaveProperty("open_count");
    expect(lean.modules[0]).toMatchObject({ id: MODULE, name: "Importer" });
    expect(lean.modules[0]).not.toHaveProperty("member_ids");
    expect(lean.actors[0]).toMatchObject({ id: USER, name: "Valentin", deleted_at: null });
    expect(lean.actors[0]).not.toHaveProperty("last_seen_at");
    expect(lean.project).toMatchObject({ identifier: "WEB", cycles_enabled: true, modules_enabled: true, estimates_enabled: false });
    expect(lean.project).not.toHaveProperty("counts");
    expect(lean.project).not.toHaveProperty("next_sequence");
    expect(lean).not.toHaveProperty("cursor");
    expect(lean).not.toHaveProperty("intake_open");
    expect(lean).not.toHaveProperty("projects");
  });

  it("is equal before and after a write that no row draws", () => {
    const bundle = makeBundle();
    const prev = toRowBundle(bundle);
    expect(shareStructure(prev, toRowBundle(afterWrite(bundle)))).toBe(prev);
  });

  it("is rejected by tsc when a stripped field is read", () => {
    const lean = toRowBundle(makeBundle());
    // @ts-expect-error the cursor moves on every write, so the row bundle has no cursor
    expect(lean.cursor).toBeUndefined();
    // @ts-expect-error a cycle's progress moves with its members
    expect(lean.cycles[0]!.progress).toBeUndefined();
    // @ts-expect-error an actor's last_seen_at moves on every agent call
    expect(lean.actors[0]!.last_seen_at).toBeUndefined();
    // @ts-expect-error the project's counts move with every created or moved item
    expect(lean.project.counts).toBeUndefined();
  });
});

describe.each([
  ["ProjectProvider", ProjectProvider],
  ["ProjectScope", ProjectScope],
])("%s", (_name, Provider) => {
  it("keeps the row context identity across a refresh that only moved cursor, counts, progress and last_seen_at", async () => {
    const bundle = makeBundle();
    await render(Provider, bundle);
    await render(Provider, afterWrite(bundle));
    expect(seen.row.length).toBeGreaterThanOrEqual(1);
    // The full context follows every write (the shell and the detail read the cursor and the counts) ...
    const full = seen.full[seen.full.length - 1]!;
    expect(full.bundle.cursor).toBe(15);
    expect(full.bundle.cycles[0]!.progress.completed).toBe(2);
    expect(full.bundle.actors[0]!.last_seen_at).toBe("2026-10-12T10:00:00.000Z");
    // ... and the row context does not.
    expect(new Set(seen.row).size).toBe(1);
  });

  it("changes the row context when a state is renamed, a label is added or the date rolls over", async () => {
    const bundle = makeBundle();
    await render(Provider, bundle);
    const first = seen.row[seen.row.length - 1]!;

    const renamed = clone(bundle);
    renamed.states[0]!.name = "To do";
    await render(Provider, renamed);
    const afterRename = seen.row[seen.row.length - 1]!;
    expect(afterRename).not.toBe(first);
    expect(afterRename.statesById.get(STATE)?.name).toBe("To do");
    // The rest of the bundle kept its identity: only the path to the renamed state is new.
    expect(afterRename.bundle.labels).toBe(first.bundle.labels);
    expect(afterRename.bundle.cycles).toBe(first.bundle.cycles);

    const labelled = clone(renamed);
    labelled.labels.push({ id: "label-2", project_id: PROJECT, name: "Chore", color: "gray", ...audit } as unknown as Label);
    await render(Provider, labelled);
    const afterLabel = seen.row[seen.row.length - 1]!;
    expect(afterLabel).not.toBe(afterRename);
    expect(afterLabel.labelsById.get("label-2")?.name).toBe("Chore");

    const tomorrow = clone(labelled);
    tomorrow.today = "2026-10-23";
    await render(Provider, tomorrow);
    expect(seen.row[seen.row.length - 1]!.bundle.today).toBe("2026-10-23");
  });
});
