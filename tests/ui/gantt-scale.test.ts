/**
 * Gantt zoom headers and dependency connectors (decisions 90–92).
 */
import { describe, expect, it } from "vitest";
import {
  conflictItemIds,
  connectorAnchors,
  connectorPaths,
  edgeConflict,
  ganttEdges,
  monthSpans,
  weekSpans,
} from "@/components/work-items/gantt-scale";
import { eachDay } from "@/components/work-items/date-span";

describe("monthSpans / weekSpans", () => {
  it("groups consecutive days into month bands", () => {
    const days = eachDay("2026-09-29", "2026-10-03");
    expect(monthSpans(days, (day) => day.slice(0, 7))).toEqual([
      { key: "2026-09", label: "2026-09", span: 2 },
      { key: "2026-10", label: "2026-10", span: 3 },
    ]);
  });

  it("groups days into weeks from the workspace week start", () => {
    // Monday start: 2026-10-05 is a Monday.
    const days = eachDay("2026-10-05", "2026-10-14");
    expect(weekSpans(days, 1, (day) => day)).toEqual([
      { key: "2026-10-05", label: "2026-10-05", span: 7 },
      { key: "2026-10-12", label: "2026-10-12", span: 3 },
    ]);
  });
});

describe("ganttEdges", () => {
  it("keeps only blocked_by, start_before and finish_before", () => {
    expect(
      ganttEdges([
        { from_id: "a", to_id: "b", type: "blocked_by" },
        { from_id: "a", to_id: "c", type: "relates_to" },
        { from_id: "d", to_id: "e", type: "start_before" },
      ]),
    ).toEqual([
      { from_id: "a", to_id: "b", type: "blocked_by" },
      { from_id: "d", to_id: "e", type: "start_before" },
    ]);
  });
});

describe("edgeConflict", () => {
  const byId = new Map([
    ["a", { start_date: "2026-10-10", target_date: "2026-10-20" }],
    ["b", { start_date: "2026-10-01", target_date: "2026-10-15" }],
  ]);

  it("flags blocked_by when the blocker finishes after the blocked item starts", () => {
    expect(edgeConflict({ from_id: "a", to_id: "b", type: "blocked_by" }, byId)).toBe(true);
  });

  it("allows blocked_by when the blocker finishes on the start day", () => {
    const ok = new Map([
      ["a", { start_date: "2026-10-15", target_date: "2026-10-20" }],
      ["b", { start_date: "2026-10-01", target_date: "2026-10-15" }],
    ]);
    expect(edgeConflict({ from_id: "a", to_id: "b", type: "blocked_by" }, ok)).toBe(false);
  });

  it("flags start_before when A starts after B", () => {
    expect(edgeConflict({ from_id: "a", to_id: "b", type: "start_before" }, byId)).toBe(true);
  });
});

describe("connectorPaths", () => {
  it("draws blocked_by from the blocker's end to the blocked item's start", () => {
    const edges = ganttEdges([{ from_id: "a", to_id: "b", type: "blocked_by" }]);
    const rowIndex = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const byId = new Map([
      ["a", { start_date: "2026-10-10", target_date: "2026-10-12" }],
      ["b", { start_date: "2026-10-01", target_date: "2026-10-03" }],
    ]);
    const paths = connectorPaths(edges, rowIndex, byId, "2026-10-01", 14);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.conflict).toBe(false);
    // B ends on day index 2 (span 3 from Oct 1); A starts on day index 9.
    expect(connectorAnchors("blocked_by")).toEqual({
      sourceId: "to_id",
      targetId: "from_id",
      source: "end",
      target: "start",
    });
    expect(paths[0]?.d).toContain("M 3 1.5");
    expect(paths[0]?.d).toContain("9 0.5");
    expect(conflictItemIds(paths).size).toBe(0);
  });

  it("marks conflicting ends in conflictItemIds", () => {
    const edges = ganttEdges([{ from_id: "a", to_id: "b", type: "blocked_by" }]);
    const rowIndex = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const byId = new Map([
      ["a", { start_date: "2026-10-02", target_date: "2026-10-04" }],
      ["b", { start_date: "2026-10-01", target_date: "2026-10-10" }],
    ]);
    const paths = connectorPaths(edges, rowIndex, byId, "2026-10-01", 14);
    expect(paths[0]?.conflict).toBe(true);
    expect([...conflictItemIds(paths)].sort()).toEqual(["a", "b"]);
  });
});
