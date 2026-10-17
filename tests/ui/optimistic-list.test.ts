/**
 * The optimistic copy of a grouped list after a move
 * (src/components/work-items/optimistic-list.ts, decision 30): a two-axis board
 * drop regroups column and lane, a drop on None empties a multi-valued field,
 * and a labels move keeps the item's other labels.
 */
import { describe, expect, it } from "vitest";
import { reduceOptimisticList } from "@/components/work-items/optimistic-list";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, Group, State, StateGroup, WorkItem, WorkItemListResult } from "@/lib/tessera/types";

const ITEM = "11111111-1111-7111-8111-111111111111";
const STATE_A = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const STATE_B = "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const LABEL_A = "cccccccc-cccc-7ccc-8ccc-cccccccccccc";
const LABEL_B = "dddddddd-dddd-7ddd-8ddd-dddddddddddd";
const LABEL_C = "eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee";

const noStates: ReadonlyMap<StateGroup, State> = new Map();
const stateGroupOf = () => undefined;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return { id: ITEM, state_id: STATE_A, priority: "low", label_ids: [], module_ids: [], assignee_ids: [], cycle_id: null, ...overrides } as WorkItem;
}

function group(field: Group["field"], id: string, itemIds: string[], subGroups?: Group[]): Group {
  return { field, id, name: id, color: null, count: itemIds.length, item_ids: itemIds, sub_groups: subGroups };
}

function listOf(items: WorkItem[], groups: Group[]): WorkItemListResult {
  return { items, total: items.length, groups } as WorkItemListResult;
}

function reduce(state: WorkItemListResult, display: Display, input: Parameters<typeof reduceOptimisticList>[1] & { type: "move" }) {
  return reduceOptimisticList(state, input, { display, stateGroupOf, firstStateByGroup: noStates });
}

describe("reduceOptimisticList move", () => {
  it("regroups the column and the lane of a two-axis drop", () => {
    const display: Display = { ...DEFAULT_DISPLAY, group_by: "state", sub_group_by: "priority" };
    const state = listOf(
      [item()],
      [
        group("state", STATE_A, [ITEM], [group("priority", "low", [ITEM]), group("priority", "high", [])]),
        group("state", STATE_B, [], [group("priority", "low", []), group("priority", "high", [])]),
      ],
    );
    const next = reduce(state, display, {
      type: "move",
      input: { id: ITEM, group_by: "state", value: STATE_B, from_value: STATE_A, sub_group_by: "priority", sub_value: "high", sub_from_value: "low" },
    });
    expect(next.items[0]?.state_id).toBe(STATE_B);
    expect(next.items[0]?.priority).toBe("high");
    const [a, b] = next.groups ?? [];
    expect(a?.item_ids).toEqual([]);
    expect(b?.item_ids).toEqual([ITEM]);
    expect(b?.count).toBe(1);
    expect(b?.sub_groups?.find((sub) => sub.id === "high")?.item_ids).toEqual([ITEM]);
    expect(b?.sub_groups?.find((sub) => sub.id === "low")?.item_ids).toEqual([]);
    expect(a?.sub_groups?.every((sub) => sub.item_ids.length === 0)).toBe(true);
  });

  it("changes only the lane of a one-axis lane drop and keeps the column", () => {
    const display: Display = { ...DEFAULT_DISPLAY, group_by: "state", sub_group_by: "priority" };
    const state = listOf([item()], [group("state", STATE_A, [ITEM], [group("priority", "low", [ITEM]), group("priority", "high", [])])]);
    const next = reduce(state, display, { type: "move", input: { id: ITEM, group_by: "priority", value: "high", from_value: "low" } });
    expect(next.items[0]?.state_id).toBe(STATE_A);
    expect(next.groups?.[0]?.item_ids).toEqual([ITEM]);
    expect(next.groups?.[0]?.sub_groups?.find((sub) => sub.id === "high")?.item_ids).toEqual([ITEM]);
  });

  it("empties the labels of an item dropped on the None group", () => {
    const display: Display = { ...DEFAULT_DISPLAY, group_by: "labels" };
    const state = listOf([item({ label_ids: [LABEL_A, LABEL_B] })], [group("labels", LABEL_A, [ITEM]), group("labels", LABEL_B, [ITEM]), group("labels", "none", [])]);
    for (const value of [null, "none"]) {
      const next = reduce(state, display, { type: "move", input: { id: ITEM, group_by: "labels", value, from_value: LABEL_A } });
      expect(next.items[0]?.label_ids).toEqual([]);
      expect(next.groups?.find((entry) => entry.id === "none")?.item_ids).toEqual([ITEM]);
      expect(next.groups?.find((entry) => entry.id === LABEL_A)?.item_ids).toEqual([]);
    }
  });

  it("keeps the other labels when a labels move swaps one", () => {
    const display: Display = { ...DEFAULT_DISPLAY, group_by: "labels" };
    const state = listOf([item({ label_ids: [LABEL_A, LABEL_B] })], [group("labels", LABEL_A, [ITEM]), group("labels", LABEL_B, [ITEM]), group("labels", LABEL_C, [])]);
    const next = reduce(state, display, { type: "move", input: { id: ITEM, group_by: "labels", value: LABEL_C, from_value: LABEL_A } });
    expect(next.items[0]?.label_ids).toEqual([LABEL_B, LABEL_C]);
    expect(next.groups?.find((entry) => entry.id === LABEL_B)?.item_ids).toEqual([ITEM]);
    expect(next.groups?.find((entry) => entry.id === LABEL_C)?.item_ids).toEqual([ITEM]);
    expect(next.groups?.find((entry) => entry.id === LABEL_A)?.item_ids).toEqual([]);
  });
});
