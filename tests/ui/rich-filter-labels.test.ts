import { describe, expect, it } from "vitest";
import {
  buildFilterLookup,
  describeRichFilters,
  fieldLabel,
  operatorLabel,
  withSelected,
} from "@/components/filters/rich-filter-labels";
import type { RichFilters } from "@/lib/tessera/types";

describe("rich-filter-labels", () => {
  it("maps field labels", () => {
    expect(fieldLabel("estimate_point")).toBe("Estimate");
    expect(fieldLabel("priority")).toBe("Priority");
    expect(fieldLabel("labels")).toBe("Labels");
  });

  it("maps operator labels depending on field", () => {
    expect(operatorLabel("labels", "in")).toBe("includes any of");
    expect(operatorLabel("priority", "eq")).toBe("is");
    expect(operatorLabel("target_date", "before")).toBe("is before");
    expect(operatorLabel("parent", "is_null")).toBe("has no parent");
    expect(operatorLabel("cycle", "is_not_null")).toBe("is in a cycle");
    expect(operatorLabel("estimate_point", "is_null")).toBe("has no estimate");
  });

  it("adds unselected values to options via withSelected", () => {
    const existing = [{ value: "1", label: "Bug" }];
    const result = withSelected(existing, ["1", "unknown-99999999"]);
    expect(result).toHaveLength(2);
    expect(result[1].value).toBe("unknown-99999999");
    expect(result[1].label).toContain("Unavailable");
  });

  it("builds filter lookup from null bundle", () => {
    const lookup = buildFilterLookup(null);
    expect(lookup.today).toBe("");
    expect(lookup.options.priority?.length).toBeGreaterThan(0);
    expect(lookup.options.state_group?.length).toBeGreaterThan(0);
    expect(lookup.options.relation_type?.length).toBeGreaterThan(0);
  });

  it("describes rich filter trees in natural language", () => {
    const lookup = buildFilterLookup(null);
    const tree: RichFilters = {
      and: [
        { field: "priority", op: "eq", value: "urgent" },
        { field: "blocked", op: "eq", value: true },
      ],
    };
    const desc = describeRichFilters(tree, lookup);
    expect(desc).toBe("Priority is Urgent and Blocked is yes");
  });

  it("describes nested and negated trees", () => {
    const lookup = buildFilterLookup(null);
    const tree: RichFilters = {
      or: [
        { not: { field: "priority", op: "eq", value: "none" } },
        {
          and: [
            { field: "target_date", op: "before", value: { op: "before", to: "2026-12-31" } },
            { field: "name", op: "contains", value: "release" },
          ],
        },
      ],
    };
    const desc = describeRichFilters(tree, lookup);
    expect(desc).toBe('not Priority is No priority or (Target date is before 2026-12-31 and Name contains "release")');
  });
});
