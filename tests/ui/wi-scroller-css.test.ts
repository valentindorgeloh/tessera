/**
 * The list scroller's sticky-band scroll padding is keyed on a class, not on `:has(.tessera-wi-group)` (decision 141):
 * the `:has()` rule made the browser re-check the scroller's whole subtree on every DOM change, about 9% of a grouped
 * 10k list's draw. WorkItemsScreen adds `tessera-wi-scroller--grouped` exactly when the list draws group bands
 * (`listShowsGroups`, src/components/work-items/list-groups.ts). The CSS is read from the stylesheet (jsdom runs no
 * layout); the screen's class is tested with the real screen in list-row-memo.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listShowsGroups, nothingMatches, visibleGroups } from "@/components/work-items/list-groups";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, Group, WorkItemListResult } from "@/lib/tessera/types";

const css = readFileSync(path.join(process.cwd(), "src/components/styles/work-items.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("work-items.css scroller rules", () => {
  it("has no :has() rule on the scroller", () => {
    expect(css).not.toMatch(/\.tessera-wi-scroller\s*:has\(/);
    expect(css).not.toMatch(/\.tessera-wi-scroller[^{]*:has\(\.tessera-wi-group\)/);
  });

  it("gives the grouped class the scroll padding, in the base rule and under the touch query", () => {
    const rules = [...css.matchAll(/(^|[\s}])\.tessera-wi-scroller--grouped\s*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(2);
    const [base, touch] = rules;
    expect(base![2]).toMatch(/scroll-padding-block-start:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-4\)\)/);
    // The second one sits inside the coarse-pointer / phone media block, where the band is 44px.
    expect(touch![2]).toMatch(/scroll-padding-block-start:\s*calc\(var\(--spacing-11\) \+ var\(--spacing-4\)\)/);
    expect(css.lastIndexOf("@media (pointer: coarse), (max-width: 480px)", touch!.index)).toBeGreaterThan(-1);
  });
});

function group(id: string, count: number): Group {
  return { field: "state", id, name: id, color: null, count, item_ids: [], has_more: false };
}
const result = (groups: Group[] | undefined, items = 0): WorkItemListResult => ({ items: Array.from({ length: items }, (_, index) => ({ id: `i${index}` })) as never, total: items, cursor: 1, groups });
const grouped: Display = { ...DEFAULT_DISPLAY, group_by: "state", show_empty_groups: false };

describe("listShowsGroups", () => {
  it("is true while the list draws at least one group band", () => {
    expect(listShowsGroups(result([group("a", 2)], 2), grouped, false)).toBe(true);
  });

  it("is false for an ungrouped list, whatever the server returned", () => {
    expect(listShowsGroups(result([group("a", 2)], 2), { ...grouped, group_by: null }, false)).toBe(false);
    expect(listShowsGroups(result(undefined, 2), grouped, false)).toBe(false);
  });

  it("is false when every group is empty and hidden, true when empty groups are shown", () => {
    const empty = result([group("a", 0), group("b", 0)]);
    expect(visibleGroups(empty, grouped)).toEqual([]);
    expect(listShowsGroups(empty, grouped, false)).toBe(false);
    expect(listShowsGroups(empty, { ...grouped, show_empty_groups: true }, false)).toBe(true);
  });

  it("is false while a filter applies and nothing matches (the list shows the no-results state)", () => {
    const none = result([group("a", 0)]);
    const showEmpty = { ...grouped, show_empty_groups: true };
    expect(nothingMatches(none, visibleGroups(none, showEmpty), true)).toBe(true);
    expect(listShowsGroups(none, showEmpty, true)).toBe(false);
    expect(listShowsGroups(none, showEmpty, false)).toBe(true);
  });
});
