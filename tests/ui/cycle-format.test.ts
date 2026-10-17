import { describe, expect, it } from "vitest";
import {
  ARCHIVE_BLOCKED_REASON,
  CYCLE_SECTIONS,
  CYCLE_STATUS_LABEL,
  DELETE_BLOCKED_REASON,
  cycleActions,
  cycleStatusOn,
  cycleStatusVariant,
  daysLeftLabel,
  formatCycleRange,
  groupCycles,
  isDayTaken,
  localIsoDate,
  overlapCandidates,
  rangeOverlaps,
  transferTargets,
  transferText,
} from "@/components/planning/cycle-format";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import type { CycleStatus } from "@/lib/tessera/types";

/**
 * Cycle formatting and menu rules (src/components/planning/cycle-format.ts,
 * docs/contracts/ui.md "Cycles (E1)"): the list sections, the range and
 * "days left" texts, which actions a cycle's menu offers in each state, the
 * days the date picker disables and the transfer targets.
 */

const TODAY = "2026-03-10";

type Fixture = { id: string; status: CycleStatus; start_date: string | null; end_date: string | null; archived_at: string | null; open_count: number };

function cycle(id: string, start: string | null, end: string | null, overrides: Partial<Fixture> = {}): Fixture {
  return { id, status: cycleStatusOn({ start_date: start, end_date: end }, TODAY), start_date: start, end_date: end, archived_at: null, open_count: 0, ...overrides };
}

const current = cycle("cur", "2026-03-05", "2026-03-15");
const upcoming = cycle("up", "2026-03-20", "2026-03-31");
const completed = cycle("done", "2026-02-01", "2026-02-14", { open_count: 3 });
const draft = cycle("draft", null, null);

describe("labels and sections", () => {
  it("labels and colours each status", () => {
    expect(CYCLE_SECTIONS.map((status) => CYCLE_STATUS_LABEL[status])).toEqual(["Current", "Upcoming", "Completed", "Draft"]);
    expect(cycleStatusVariant("current")).toBe("accent");
    expect(cycleStatusVariant("completed")).toBe("success");
    expect(cycleStatusVariant("upcoming")).toBe("neutral");
    expect(cycleStatusVariant("draft")).toBe("neutral");
  });

  it("groups in the order Current, Upcoming, Completed, Draft and keeps the engine order inside a section", () => {
    const later = cycle("up2", "2026-04-01", "2026-04-10");
    const sections = groupCycles([draft, upcoming, completed, current, later]);
    expect(sections.map((section) => section.label)).toEqual(["Current", "Upcoming", "Completed", "Draft"]);
    expect(sections[1].cycles.map((c) => c.id)).toEqual(["up", "up2"]);
  });

  it("leaves empty sections out", () => {
    expect(groupCycles([draft, upcoming]).map((section) => section.key)).toEqual(["upcoming", "draft"]);
    expect(groupCycles([])).toEqual([]);
  });
});

describe("dates", () => {
  it("formats a range through formatShortDate, and drafts as No dates", () => {
    expect(formatCycleRange("2026-03-01", "2026-03-14", TODAY)).toBe(`${formatShortDate("2026-03-01", TODAY)} – ${formatShortDate("2026-03-14", TODAY)}`);
    expect(formatCycleRange(null, null, TODAY)).toBe("No dates");
    expect(formatCycleRange("2026-03-01", null, TODAY)).toBe("No dates");
    // The year shows for a date outside today's year.
    expect(formatCycleRange("2026-12-28", "2027-01-10", TODAY)).toBe("Dec 28 – Jan 10, 2027");
  });

  it("counts the days left to the end date", () => {
    expect(daysLeftLabel("2026-03-15", TODAY)).toBe("5 days left");
    expect(daysLeftLabel("2026-03-11", TODAY)).toBe("1 day left");
    expect(daysLeftLabel(TODAY, TODAY)).toBe("Ends today");
    expect(daysLeftLabel("2026-03-09", TODAY)).toBe("Ended");
  });

  it("derives the status from the dates, both ends inclusive", () => {
    expect(cycleStatusOn({ start_date: null, end_date: null }, TODAY)).toBe("draft");
    expect(cycleStatusOn({ start_date: "2026-03-11", end_date: "2026-03-20" }, TODAY)).toBe("upcoming");
    expect(cycleStatusOn({ start_date: TODAY, end_date: TODAY }, TODAY)).toBe("current");
    expect(cycleStatusOn({ start_date: "2026-03-01", end_date: "2026-03-09" }, TODAY)).toBe("completed");
  });

  it("writes a picker day as YYYY-MM-DD from its local date", () => {
    expect(localIsoDate(new Date(2026, 2, 1))).toBe("2026-03-01");
    expect(localIsoDate(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });

  it("disables the days of other cycles, inclusive at both ends, ignoring drafts", () => {
    const others = [current, draft];
    expect(isDayTaken("2026-03-05", others)).toBe(true);
    expect(isDayTaken("2026-03-15", others)).toBe(true);
    expect(isDayTaken("2026-03-04", others)).toBe(false);
    expect(isDayTaken("2026-03-16", others)).toBe(false);
  });

  it("finds a range that overlaps another cycle", () => {
    const others = [current, draft];
    expect(rangeOverlaps("2026-03-01", "2026-03-05", others)).toBe(true);
    expect(rangeOverlaps("2026-03-15", "2026-03-20", others)).toBe(true);
    expect(rangeOverlaps("2026-03-01", "2026-03-31", others)).toBe(true);
    expect(rangeOverlaps("2026-03-16", "2026-03-20", others)).toBe(false);
    expect(rangeOverlaps("2026-02-01", "2026-03-04", others)).toBe(false);
  });

  it("leaves the edited cycle out of the overlap candidates", () => {
    expect(overlapCandidates([current, upcoming, draft], "cur").map((c) => c.id)).toEqual(["up", "draft"]);
    expect(overlapCandidates([current, upcoming], null).map((c) => c.id)).toEqual(["cur", "up"]);
  });
});

describe("cycleActions", () => {
  const ids = (c: Fixture) => cycleActions(c, TODAY).map((action) => action.id);

  it("open cycles: Edit, a disabled Archive and Delete", () => {
    for (const c of [current, upcoming, draft]) {
      expect(ids(c)).toEqual(["edit", "archive", "delete"]);
      const actions = cycleActions(c, TODAY);
      expect(actions.find((action) => action.id === "archive")).toMatchObject({ isDisabled: true, description: ARCHIVE_BLOCKED_REASON });
      expect(actions.find((action) => action.id === "delete")).toMatchObject({ label: "Delete…", variant: "destructive" });
      expect(actions.find((action) => action.id === "delete")?.isDisabled).toBeUndefined();
    }
  });

  it("completed with open items: Transfer, Archive, Delete blocked until archived", () => {
    const actions = cycleActions(completed, TODAY);
    expect(actions.map((action) => action.id)).toEqual(["transfer", "archive", "delete"]);
    expect(actions[0].label).toBe("Transfer open items…");
    expect(actions[1].isDisabled).toBeUndefined();
    expect(actions[2]).toMatchObject({ isDisabled: true, description: DELETE_BLOCKED_REASON });
  });

  it("completed without open items has no Transfer", () => {
    expect(ids({ ...completed, open_count: 0 })).toEqual(["archive", "delete"]);
  });

  it("archived: Restore and an enabled Delete, nothing else", () => {
    const archived = { ...completed, archived_at: "2026-02-20T10:00:00.000Z" };
    const actions = cycleActions(archived, TODAY);
    expect(actions.map((action) => action.id)).toEqual(["restore", "delete"]);
    expect(actions[1].isDisabled).toBeUndefined();
  });

  it("follows the dates, not the stored status: a cycle ending yesterday is completed", () => {
    expect(ids(cycle("x", "2026-03-01", "2026-03-09", { status: "current" }))).toEqual(["archive", "delete"]);
  });
});

describe("transferTargets", () => {
  it("offers current, upcoming and draft cycles, never the source or a completed cycle", () => {
    const other = cycle("done2", "2026-01-01", "2026-01-14");
    expect(transferTargets([current, upcoming, completed, other, draft], "done").map((c) => c.id)).toEqual(["cur", "up", "draft"]);
    expect(transferTargets([completed], "done")).toEqual([]);
  });
});

describe("transferText", () => {
  it("says the progress freezes now when the cycle has no snapshot yet", () => {
    expect(transferText("Sprint 1", 3, false)).toBe("Move the 3 open work items of Sprint 1. Its progress is frozen as it is now.");
    expect(transferText("Sprint 1", 1, false)).toBe("Move the 1 open work item of Sprint 1. Its progress is frozen as it is now.");
  });

  it("says an earlier snapshot stays when the cycle is already frozen (archived, then restored)", () => {
    expect(transferText("Sprint 1", 2, true)).toBe("Move the 2 open work items of Sprint 1. Its progress was frozen earlier and stays as it was then.");
  });
});
