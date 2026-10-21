/**
 * Gantt zoom headers and dependency connectors (decisions 90–92).
 */
import { describe, expect, it } from "vitest";
import {
  conflictItemIds,
  conflictNotes,
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

describe("conflictNotes", () => {
  const rowIndex = new Map([
    ["a", 0],
    ["b", 1],
  ]);
  const keys = new Map([
    ["a", "WEB-1"],
    ["b", "WEB-2"],
  ]);
  const notesFor = (type: "blocked_by" | "start_before" | "finish_before", a: { start_date: string; target_date: string }, b: { start_date: string; target_date: string }) => {
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    const paths = connectorPaths(ganttEdges([{ from_id: "a", to_id: "b", type }]), rowIndex, byId, "2026-10-01", 40);
    return conflictNotes(paths, byId, keys);
  };

  it("names the blocker and its end date on the blocked bar, and the blocked item on the blocker (decision 92)", () => {
    const notes = notesFor("blocked_by", { start_date: "2026-10-02", target_date: "2026-10-04" }, { start_date: "2026-10-01", target_date: "2026-10-10" });
    expect(notes.get("a")).toEqual(["Blocked by WEB-2, which ends 2026-10-10"]);
    expect(notes.get("b")).toEqual(["Blocks WEB-1, which starts 2026-10-02"]);
  });

  it("is empty when the blocker ends the day the blocked item starts", () => {
    const notes = notesFor("blocked_by", { start_date: "2026-10-10", target_date: "2026-10-12" }, { start_date: "2026-10-01", target_date: "2026-10-10" });
    expect(notes.size).toBe(0);
  });

  it("describes start_before and finish_before conflicts by the dates that break them", () => {
    const start = notesFor("start_before", { start_date: "2026-10-08", target_date: "2026-10-09" }, { start_date: "2026-10-05", target_date: "2026-10-09" });
    expect(start.get("a")).toEqual(["Should start before WEB-2, which starts 2026-10-05"]);
    expect(start.get("b")).toEqual(["Should start after WEB-1, which starts 2026-10-08"]);
    const finish = notesFor("finish_before", { start_date: "2026-10-01", target_date: "2026-10-12" }, { start_date: "2026-10-01", target_date: "2026-10-09" });
    expect(finish.get("a")).toEqual(["Should finish before WEB-2, which ends 2026-10-09"]);
    expect(finish.get("b")).toEqual(["Should finish after WEB-1, which ends 2026-10-12"]);
  });

  it("lists every conflict of one bar once", () => {
    const byId = new Map([
      ["a", { start_date: "2026-10-02", target_date: "2026-10-04" }],
      ["b", { start_date: "2026-10-01", target_date: "2026-10-10" }],
      ["c", { start_date: "2026-10-01", target_date: "2026-10-08" }],
    ]);
    const edges = ganttEdges([
      { from_id: "a", to_id: "b", type: "blocked_by" },
      { from_id: "a", to_id: "c", type: "blocked_by" },
    ]);
    const index = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    const paths = connectorPaths(edges, index, byId, "2026-10-01", 40);
    const notes = conflictNotes(paths, byId, new Map([...keys, ["c", "WEB-3"]]));
    expect(notes.get("a")).toEqual(["Blocked by WEB-2, which ends 2026-10-10", "Blocked by WEB-3, which ends 2026-10-08"]);
  });
});
