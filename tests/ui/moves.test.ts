/**
 * Layout move translation (src/components/work-items/moves.ts): which groups
 * a board may move between and how a state_group drop reaches the engine.
 */
import { describe, expect, it } from "vitest";
import { isMovableGroup, moveToolInput, toEngineMove } from "@/components/work-items/moves";
import type { MoveInput } from "@/components/work-items/types";
import type { State, StateGroup } from "@/lib/tessera/types";

const ITEM = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";
const STARTED_STATE = "33333333-3333-7333-8333-333333333333";

const started = { id: STARTED_STATE, state_group: "started", name: "In progress" } as State;
const firstStateByGroup: ReadonlyMap<StateGroup, State> = new Map([["started", started]]);

describe("isMovableGroup", () => {
  it("allows the fields the engine moves between plus state_group", () => {
    for (const field of ["state", "state_group", "priority", "labels", "cycle", "module", "assignees", "start_date", "target_date"] as const) {
      expect(isMovableGroup(field)).toBe(true);
    }
  });

  it("refuses created_by, created_at, project and an ungrouped layout", () => {
    expect(isMovableGroup("created_by")).toBe(false);
    expect(isMovableGroup("created_at")).toBe(false);
    expect(isMovableGroup("project")).toBe(false);
    expect(isMovableGroup(null)).toBe(false);
  });
});

describe("toEngineMove", () => {
  it("passes an engine-movable group change through with its placement", () => {
    const input: MoveInput = { id: ITEM, group_by: "priority", value: "high", from_value: "low", before_id: OTHER };
    expect(toEngineMove(input, firstStateByGroup)).toEqual(input);
  });

  it("passes a pure reorder through", () => {
    const input: MoveInput = { id: ITEM, after_id: OTHER };
    expect(toEngineMove(input, firstStateByGroup)).toEqual({ id: ITEM, after_id: OTHER });
  });

  it("turns a state_group move into a move to the group's first state", () => {
    const result = toEngineMove({ id: ITEM, group_by: "state_group", value: "started", from_value: "backlog" }, firstStateByGroup);
    expect(result).toEqual({ id: ITEM, group_by: "state", value: STARTED_STATE });
  });

  it("keeps the placement of a state_group move", () => {
    const result = toEngineMove({ id: ITEM, group_by: "state_group", value: "started", before_id: OTHER }, firstStateByGroup);
    expect(result).toEqual({ id: ITEM, group_by: "state", value: STARTED_STATE, before_id: OTHER });
  });

  it("drops a state_group move whose group has no state", () => {
    expect(toEngineMove({ id: ITEM, group_by: "state_group", value: "completed" }, firstStateByGroup)).toBeNull();
    expect(toEngineMove({ id: ITEM, group_by: "state_group", value: null }, firstStateByGroup)).toBeNull();
    expect(toEngineMove({ id: ITEM, group_by: "state_group", value: "completed", after_id: OTHER }, firstStateByGroup)).toEqual({ id: ITEM, after_id: OTHER });
  });

  it("reduces created_by, created_at and project moves to their reorder part", () => {
    expect(toEngineMove({ id: ITEM, group_by: "created_by", value: OTHER }, firstStateByGroup)).toBeNull();
    expect(toEngineMove({ id: ITEM, group_by: "created_at", value: "2026-10-11", before_id: OTHER }, firstStateByGroup)).toEqual({ id: ITEM, before_id: OTHER });
    expect(toEngineMove({ id: ITEM, group_by: "project", value: OTHER }, firstStateByGroup)).toBeNull();
  });

  it("returns null when there is no group change and no placement", () => {
    expect(toEngineMove({ id: ITEM }, firstStateByGroup)).toBeNull();
    expect(toEngineMove({ id: ITEM, group_by: null }, firstStateByGroup)).toBeNull();
  });
});

describe("toEngineMove, sub axis (decision 30)", () => {
  it("forwards a two-axis drop with both axes and the placement", () => {
    const input: MoveInput = {
      id: ITEM,
      group_by: "labels",
      value: "col-b",
      from_value: "col-a",
      sub_group_by: "assignees",
      sub_value: "lane-b",
      sub_from_value: "lane-a",
      before_id: OTHER,
    };
    expect(toEngineMove(input, firstStateByGroup)).toEqual(input);
  });

  it("translates a state_group on the sub axis to the group's first state", () => {
    const result = toEngineMove({ id: ITEM, group_by: "priority", value: "high", sub_group_by: "state_group", sub_value: "started", sub_from_value: "backlog" }, firstStateByGroup);
    expect(result).toEqual({ id: ITEM, group_by: "priority", value: "high", sub_group_by: "state", sub_value: STARTED_STATE });
  });

  it("translates a state_group on the main axis while the sub axis stays", () => {
    const result = toEngineMove({ id: ITEM, group_by: "state_group", value: "started", sub_group_by: "priority", sub_value: "high" }, firstStateByGroup);
    expect(result).toEqual({ id: ITEM, group_by: "state", value: STARTED_STATE, sub_group_by: "priority", sub_value: "high" });
  });

  it("returns null, no request, for a non-movable field on either axis", () => {
    expect(toEngineMove({ id: ITEM, group_by: "priority", value: "high", sub_group_by: "created_by", sub_value: OTHER }, firstStateByGroup)).toBeNull();
    expect(toEngineMove({ id: ITEM, group_by: "project", value: OTHER, sub_group_by: "priority", sub_value: "high" }, firstStateByGroup)).toBeNull();
    expect(toEngineMove({ id: ITEM, group_by: "priority", value: "high", sub_group_by: "created_at", sub_value: "2026-10-11" }, firstStateByGroup)).toBeNull();
  });

  it("returns null for a sub-axis state_group without a state", () => {
    expect(toEngineMove({ id: ITEM, group_by: "priority", value: "high", sub_group_by: "state_group", sub_value: "completed" }, firstStateByGroup)).toBeNull();
  });

  it("passes a one-axis lane drop through as an ordinary move", () => {
    const input: MoveInput = { id: ITEM, group_by: "assignees", value: "lane-b", from_value: "lane-a", after_id: OTHER };
    expect(toEngineMove(input, firstStateByGroup)).toEqual(input);
  });
});

describe("moveToolInput (F3.6)", () => {
  it("sends both axes of a board drop, with from values only for multi-valued fields", () => {
    const input: MoveInput = { id: ITEM, group_by: "labels", value: "col-b", from_value: "col-a", sub_group_by: "assignees", sub_value: "lane-b", sub_from_value: "lane-a", before_id: OTHER };
    expect(moveToolInput(input)).toEqual({
      work_item_id: ITEM,
      group_by: "labels",
      value: "col-b",
      from_value: "col-a",
      sub_group_by: "assignees",
      sub_value: "lane-b",
      sub_from_value: "lane-a",
      before_id: OTHER,
      after_id: undefined,
    });
  });

  it("drops from values of single-valued fields on either axis", () => {
    const input: MoveInput = { id: ITEM, group_by: "priority", value: "high", from_value: "low", sub_group_by: "state", sub_value: STARTED_STATE, sub_from_value: "old" };
    const tool = moveToolInput(input);
    expect(tool).not.toHaveProperty("from_value");
    expect(tool).not.toHaveProperty("sub_from_value");
    expect(tool).toMatchObject({ group_by: "priority", value: "high", sub_group_by: "state", sub_value: STARTED_STATE });
  });

  it("sends a one-axis move and a pure reorder without sub fields", () => {
    expect(moveToolInput({ id: ITEM, group_by: "assignees", value: "lane-b", from_value: "lane-a" })).toEqual({
      work_item_id: ITEM,
      group_by: "assignees",
      value: "lane-b",
      from_value: "lane-a",
      before_id: undefined,
      after_id: undefined,
    });
    expect(moveToolInput({ id: ITEM, after_id: OTHER })).toEqual({ work_item_id: ITEM, before_id: undefined, after_id: OTHER });
  });
});
