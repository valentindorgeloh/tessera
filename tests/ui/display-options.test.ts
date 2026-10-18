/**
 * Display menu choices (src/components/work-items/display-options.ts): Order
 * by lists "Manual" once, Sub-group by drops the group field and turned-off
 * features, and a Group by change clears a sub-group that would repeat it.
 */
import { describe, expect, it } from "vitest";
import { groupByChoices, groupByPatch, orderByChoices, orderBySelectValue, subGroupChoices } from "@/components/work-items/display-options";
import { ORDER_BY_VALUES } from "@/lib/tessera/core/group";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";

const BOTH = { cycles_enabled: true, modules_enabled: true };

describe("orderByChoices", () => {
  it("offers Manual exactly once", () => {
    const choices = orderByChoices();
    expect(choices.filter((choice) => choice.label === "Manual")).toEqual([{ value: "sort_order", label: "Manual" }]);
    expect(choices.some((choice) => choice.value === "-sort_order")).toBe(false);
  });

  it("offers only values the schema accepts, once each", () => {
    const values = orderByChoices().map((choice) => choice.value);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(ORDER_BY_VALUES).toContain(value);
  });

  it("keeps the spec's labels", () => {
    const labels = new Map(orderByChoices().map((choice) => [choice.value, choice.label]));
    expect(labels.get("-created_at")).toBe("Created (newest first)");
    expect(labels.get("priority")).toBe("Priority (urgent first)");
    expect(labels.get("-sequence_id")).toBe("Key (newest first)");
  });

  it("shows a stored -sort_order as Manual", () => {
    const labels = new Map(orderByChoices().map((choice) => [choice.value, choice.label]));
    expect(labels.get(orderBySelectValue("-sort_order"))).toBe("Manual");
    expect(orderBySelectValue("name")).toBe("name");
  });
});

describe("groupByChoices", () => {
  const values = (project = BOTH, hidden: Parameters<typeof groupByChoices>[1] = []) => groupByChoices(project, hidden).map((choice) => choice.value);

  it("starts with None and never offers Project", () => {
    expect(groupByChoices(BOTH, [])[0]).toEqual({ value: null, label: "None" });
    expect(values()).not.toContain("project");
    expect(values()).toContain("state");
  });

  it("offers Project on a cross-project list", () => {
    expect(groupByChoices(BOTH, [], true).map((choice) => choice.value)).toContain("project");
    expect(groupByChoices(BOTH, ["project"], true).map((choice) => choice.value)).not.toContain("project");
  });

  it("drops hidden fields and the cycle and module groups of turned-off features", () => {
    expect(values(BOTH, ["cycle"])).not.toContain("cycle");
    expect(values({ cycles_enabled: false, modules_enabled: true })).not.toContain("cycle");
    expect(values({ cycles_enabled: true, modules_enabled: false })).not.toContain("module");
  });
});

describe("subGroupChoices", () => {
  const values = (display: typeof DEFAULT_DISPLAY, project = BOTH, hidden: Parameters<typeof subGroupChoices>[2] = []) =>
    subGroupChoices(display, project, hidden).map((choice) => choice.value);

  it("starts with None", () => {
    expect(subGroupChoices(DEFAULT_DISPLAY, BOTH, [])[0]).toEqual({ value: null, label: "None" });
  });

  it("drops the group field", () => {
    expect(values({ ...DEFAULT_DISPLAY, group_by: "state" })).not.toContain("state");
    expect(values(DEFAULT_DISPLAY)).toContain("state");
  });

  it("drops cycle and module when their features are off, and hidden fields", () => {
    expect(values(DEFAULT_DISPLAY, { cycles_enabled: false, modules_enabled: true })).not.toContain("cycle");
    expect(values(DEFAULT_DISPLAY, { cycles_enabled: true, modules_enabled: false })).not.toContain("module");
    expect(values(DEFAULT_DISPLAY, BOTH, ["cycle"])).not.toContain("cycle");
    expect(values(DEFAULT_DISPLAY, BOTH)).toEqual(expect.arrayContaining(["cycle", "module"]));
  });
});

describe("groupByPatch", () => {
  it("sets the group and keeps an unrelated sub-group", () => {
    expect(groupByPatch({ ...DEFAULT_DISPLAY, sub_group_by: "priority" }, "state")).toEqual({ group_by: "state" });
  });

  it("clears the sub-group when it equals the new group or the grouping is removed", () => {
    expect(groupByPatch({ ...DEFAULT_DISPLAY, sub_group_by: "state" }, "state")).toEqual({ group_by: "state", sub_group_by: null });
    expect(groupByPatch({ ...DEFAULT_DISPLAY, group_by: "state", sub_group_by: "priority" }, null)).toEqual({ group_by: null, sub_group_by: null });
  });
});
