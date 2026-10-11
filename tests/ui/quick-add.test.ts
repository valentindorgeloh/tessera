/**
 * Quick-add rules (src/components/work-items/quick-add.ts): the create input a
 * group's row sends, how a scoped list joins it to its cycle or module, which
 * groups show a row in a cycle (closed states cannot join one), and the open
 * modules and cycles that quick-add rows and board moves are limited to.
 */
import { describe, expect, it } from "vitest";
import {
  acceptsGroupMove,
  isOpenGroupValue,
  openMemberships,
  quickAddAllowed,
  quickAddInput,
  withScopeDefaults,
  type OpenMemberships,
  type QuickAddContext,
} from "@/components/work-items/quick-add";
import type { Cycle, Module, State } from "@/lib/tessera/types";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const CYCLE = "22222222-2222-7222-8222-222222222222";
const OTHER_CYCLE = "33333333-3333-7333-8333-333333333333";
const MODULE = "44444444-4444-7444-8444-444444444444";
const OTHER_MODULE = "55555555-5555-7555-8555-555555555555";
const LABEL = "66666666-6666-7666-8666-666666666666";
const ARCHIVED_MODULE = "77777777-7777-7777-8777-777777777777";
const COMPLETED_CYCLE = "88888888-8888-7888-8888-888888888888";
const ARCHIVED_CYCLE = "99999999-9999-7999-8999-999999999999";

const state = (id: string, state_group: State["state_group"], name: string) => ({ id, state_group, name }) as State;
const BACKLOG = state("a0000000-0000-7000-8000-000000000001", "backlog", "Backlog");
const TODO = state("a0000000-0000-7000-8000-000000000002", "unstarted", "Todo");
const DONE = state("a0000000-0000-7000-8000-000000000003", "completed", "Done");
const DONE_LATER = state("a0000000-0000-7000-8000-000000000004", "completed", "Shipped");
const CANCELLED = state("a0000000-0000-7000-8000-000000000005", "cancelled", "Cancelled");
const STATES = [BACKLOG, TODO, DONE, DONE_LATER, CANCELLED];

/** What `openMemberships` gives for a bundle with two open modules and two open cycles (the closed ids are absent). */
const OPEN: OpenMemberships = { openModuleIds: new Set([MODULE, OTHER_MODULE]), openCycleIds: new Set([CYCLE, OTHER_CYCLE]) };

const projectList: QuickAddContext = { projectId: PROJECT, states: STATES, ...OPEN };
const cycleList: QuickAddContext = { projectId: PROJECT, states: STATES, ...OPEN, scopeDefaults: { cycle_id: CYCLE } };
const moduleList: QuickAddContext = { projectId: PROJECT, states: STATES, ...OPEN, scopeDefaults: { module_ids: [MODULE] } };

describe("openMemberships", () => {
  const moduleOf = (id: string, archived_at: string | null) => ({ id, archived_at }) as Module;
  const cycleOf = (id: string, status: Cycle["status"], archived_at: string | null = null) => ({ id, status, archived_at }) as Cycle;

  it("keeps non-archived modules and cycles that are neither completed nor archived", () => {
    const open = openMemberships({
      modules: [moduleOf(MODULE, null), moduleOf(ARCHIVED_MODULE, "2026-10-11T10:00:00.000Z")],
      cycles: [
        cycleOf(CYCLE, "current"),
        cycleOf(OTHER_CYCLE, "draft"),
        cycleOf(COMPLETED_CYCLE, "completed"),
        cycleOf(ARCHIVED_CYCLE, "completed", "2026-10-11T10:00:00.000Z"),
      ],
    });
    expect([...open.openModuleIds]).toEqual([MODULE]);
    expect([...open.openCycleIds]).toEqual([CYCLE, OTHER_CYCLE]);
  });

  it("keeps an upcoming cycle and is empty for an empty bundle", () => {
    expect([...openMemberships({ modules: [], cycles: [cycleOf(CYCLE, "upcoming")] }).openCycleIds]).toEqual([CYCLE]);
    const none = openMemberships({ modules: [], cycles: [] });
    expect(none.openModuleIds.size + none.openCycleIds.size).toBe(0);
  });
});

describe("isOpenGroupValue and acceptsGroupMove", () => {
  it("closes module and cycle values that are not open", () => {
    expect(isOpenGroupValue("module", MODULE, OPEN)).toBe(true);
    expect(isOpenGroupValue("module", ARCHIVED_MODULE, OPEN)).toBe(false);
    expect(isOpenGroupValue("cycle", CYCLE, OPEN)).toBe(true);
    expect(isOpenGroupValue("cycle", COMPLETED_CYCLE, OPEN)).toBe(false);
    expect(isOpenGroupValue("cycle", ARCHIVED_CYCLE, OPEN)).toBe(false);
  });

  it("leaves the none group, other fields and an ungrouped list open", () => {
    expect(isOpenGroupValue("module", null, OPEN)).toBe(true);
    expect(isOpenGroupValue("cycle", null, OPEN)).toBe(true);
    // An id that is only a module's or a cycle's means nothing to another field.
    expect(isOpenGroupValue("labels", ARCHIVED_MODULE, OPEN)).toBe(true);
    expect(isOpenGroupValue("state", COMPLETED_CYCLE, OPEN)).toBe(true);
    expect(isOpenGroupValue(null, null, OPEN)).toBe(true);
  });

  it("accepts a board move only when the item may leave one value and join the other", () => {
    expect(acceptsGroupMove("module", MODULE, OTHER_MODULE, OPEN)).toBe(true);
    expect(acceptsGroupMove("module", null, MODULE, OPEN)).toBe(true);
    expect(acceptsGroupMove("module", MODULE, null, OPEN)).toBe(true);
    // Into or out of an archived module: refused (ARCHIVED).
    expect(acceptsGroupMove("module", MODULE, ARCHIVED_MODULE, OPEN)).toBe(false);
    expect(acceptsGroupMove("module", ARCHIVED_MODULE, MODULE, OPEN)).toBe(false);
    expect(acceptsGroupMove("module", ARCHIVED_MODULE, null, OPEN)).toBe(false);
    // Into or out of a completed (LOCKED) or archived (ARCHIVED) cycle: refused.
    expect(acceptsGroupMove("cycle", CYCLE, OTHER_CYCLE, OPEN)).toBe(true);
    expect(acceptsGroupMove("cycle", null, COMPLETED_CYCLE, OPEN)).toBe(false);
    expect(acceptsGroupMove("cycle", COMPLETED_CYCLE, CYCLE, OPEN)).toBe(false);
    expect(acceptsGroupMove("cycle", ARCHIVED_CYCLE, null, OPEN)).toBe(false);
    expect(acceptsGroupMove("cycle", CYCLE, ARCHIVED_CYCLE, OPEN)).toBe(false);
    // Other fields are not limited here (./moves.ts decides which fields move at all).
    expect(acceptsGroupMove("priority", "high", "low", OPEN)).toBe(true);
  });
});

describe("quickAddAllowed", () => {
  it("hides both kinds of closed group in a cycle scope", () => {
    expect(quickAddAllowed({ field: "state", value: DONE.id }, cycleList)).toBe(false);
    expect(quickAddAllowed({ field: "state", value: CANCELLED.id }, cycleList)).toBe(false);
    expect(quickAddAllowed({ field: "state_group", value: "completed" }, cycleList)).toBe(false);
    expect(quickAddAllowed({ field: "state_group", value: "cancelled" }, cycleList)).toBe(false);
  });

  it("shows the closed groups in a module scope and in the project list", () => {
    for (const context of [moduleList, projectList]) {
      expect(quickAddAllowed({ field: "state", value: DONE.id }, context)).toBe(true);
      expect(quickAddAllowed({ field: "state", value: CANCELLED.id }, context)).toBe(true);
      expect(quickAddAllowed({ field: "state_group", value: "completed" }, context)).toBe(true);
      expect(quickAddAllowed({ field: "state_group", value: "cancelled" }, context)).toBe(true);
    }
  });

  it("hides the groups of an archived module and of a completed or archived cycle in every list", () => {
    for (const context of [projectList, cycleList, moduleList]) {
      expect(quickAddAllowed({ field: "module", value: ARCHIVED_MODULE }, context)).toBe(false);
      expect(quickAddAllowed({ field: "cycle", value: COMPLETED_CYCLE }, context)).toBe(false);
      expect(quickAddAllowed({ field: "cycle", value: ARCHIVED_CYCLE }, context)).toBe(false);
    }
  });

  it("shows the groups of open modules and cycles and their none group", () => {
    for (const context of [projectList, cycleList, moduleList]) {
      expect(quickAddAllowed({ field: "module", value: MODULE }, context)).toBe(true);
      expect(quickAddAllowed({ field: "module", value: OTHER_MODULE }, context)).toBe(true);
      expect(quickAddAllowed({ field: "cycle", value: CYCLE }, context)).toBe(true);
      expect(quickAddAllowed({ field: "module", value: null }, context)).toBe(true);
      expect(quickAddAllowed({ field: "cycle", value: null }, context)).toBe(true);
    }
  });

  it("shows open groups, other fields, the none group and an ungrouped list in a cycle scope", () => {
    expect(quickAddAllowed({ field: "state", value: BACKLOG.id }, cycleList)).toBe(true);
    expect(quickAddAllowed({ field: "state", value: TODO.id }, cycleList)).toBe(true);
    expect(quickAddAllowed({ field: "state_group", value: "started" }, cycleList)).toBe(true);
    expect(quickAddAllowed({ field: "priority", value: "high" }, cycleList)).toBe(true);
    expect(quickAddAllowed({ field: "labels", value: null }, cycleList)).toBe(true);
    expect(quickAddAllowed({ field: null, value: null }, cycleList)).toBe(true);
  });
});

describe("quickAddInput", () => {
  it("keeps the project list's input: the group's field carries the group's value", () => {
    expect(quickAddInput({ field: null, value: null }, "Alpha", projectList)).toEqual({ project_id: PROJECT, name: "Alpha", source: "in_app" });
    expect(quickAddInput({ field: "priority", value: "high" }, "Alpha", projectList)).toMatchObject({ priority: "high" });
    expect(quickAddInput({ field: "labels", value: LABEL }, "Alpha", projectList)).toMatchObject({ label_ids: [LABEL] });
    expect(quickAddInput({ field: "state", value: TODO.id }, "Alpha", projectList)).toMatchObject({ state_id: TODO.id });
  });

  it("uses the first state of a state group and refuses values it cannot map", () => {
    expect(quickAddInput({ field: "state_group", value: "completed" }, "Alpha", projectList)).toMatchObject({ state_id: DONE.id });
    expect(quickAddInput({ field: "state_group", value: "started" }, "Alpha", projectList)).toBeNull();
    expect(quickAddInput({ field: "state_group", value: "bogus" }, "Alpha", projectList)).toBeNull();
    expect(quickAddInput({ field: "priority", value: "huge" }, "Alpha", projectList)).toBeNull();
    expect(quickAddInput({ field: "created_by", value: "x" }, "Alpha", projectList)).toBeNull();
  });

  it("joins the cycle of a cycle scope", () => {
    expect(quickAddInput({ field: null, value: null }, "Alpha", cycleList)).toEqual({ project_id: PROJECT, name: "Alpha", source: "in_app", cycle_id: CYCLE });
    expect(quickAddInput({ field: "state", value: TODO.id }, "Alpha", cycleList)).toMatchObject({ state_id: TODO.id, cycle_id: CYCLE });
  });

  it("keeps a cycle the group names (cycle_id ??=)", () => {
    expect(quickAddInput({ field: "cycle", value: OTHER_CYCLE }, "Alpha", cycleList)?.cycle_id).toBe(OTHER_CYCLE);
  });

  it("unites the module ids of the group and the scope", () => {
    expect(quickAddInput({ field: null, value: null }, "Alpha", moduleList)?.module_ids).toEqual([MODULE]);
    expect(quickAddInput({ field: "module", value: OTHER_MODULE }, "Alpha", moduleList)?.module_ids).toEqual([OTHER_MODULE, MODULE]);
    expect(quickAddInput({ field: "module", value: MODULE }, "Alpha", moduleList)?.module_ids).toEqual([MODULE]);
  });

  it("merges both memberships when the scope names a cycle and modules", () => {
    const both: QuickAddContext = { projectId: PROJECT, states: STATES, ...OPEN, scopeDefaults: { cycle_id: CYCLE, module_ids: [MODULE] } };
    expect(quickAddInput({ field: "module", value: OTHER_MODULE }, "Alpha", both)).toMatchObject({ cycle_id: CYCLE, module_ids: [OTHER_MODULE, MODULE] });
  });
});

describe("withScopeDefaults (create dialog defaults)", () => {
  it("passes the defaults through without a scope", () => {
    const defaults = { name: "Alpha", module_ids: [OTHER_MODULE] };
    expect(withScopeDefaults(defaults, undefined)).toBe(defaults);
  });

  it("starts the dialog in the scope, the dialog's own values first and module ids united", () => {
    expect(withScopeDefaults({}, { cycle_id: CYCLE, module_ids: [MODULE] })).toEqual({ cycle_id: CYCLE, module_ids: [MODULE] });
    expect(withScopeDefaults({ name: "Alpha", cycle_id: OTHER_CYCLE }, { cycle_id: CYCLE })).toEqual({ name: "Alpha", cycle_id: OTHER_CYCLE });
    expect(withScopeDefaults({ module_ids: [OTHER_MODULE] }, { module_ids: [MODULE] })).toEqual({ module_ids: [OTHER_MODULE, MODULE] });
  });
});
