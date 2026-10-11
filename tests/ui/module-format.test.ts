import { describe, expect, it } from "vitest";
import {
  ARCHIVABLE_STATUSES,
  ARCHIVE_BLOCKED_REASON,
  MODULE_STATUS_LABEL,
  MODULE_STATUSES,
  canArchiveModule,
  changedModuleFields,
  formatModuleRange,
  isHttpUrl,
  isModuleStatus,
  moduleActions,
  moduleDateError,
  moduleProgressText,
  moduleProgressValues,
  moduleStatusVariant,
  sameMembers,
} from "@/components/planning/module-format";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { ARCHIVABLE_MODULE_STATUSES } from "@/lib/tessera/modules";
import { ModuleStatusSchema } from "@/lib/tessera/schemas";
import type { CycleProgressSummary } from "@/lib/tessera/types";

/**
 * Module helpers (src/components/planning/module-format.ts, docs/contracts/ui.md
 * "Modules (E2)"): labels and colours for every status, the archive rule kept
 * equal to the engine's, date ranges, the menu entries per state, the date
 * error mapping and the edit diff.
 */

describe("module statuses", () => {
  it("labels every engine status in plain English", () => {
    expect(Object.keys(MODULE_STATUS_LABEL).sort()).toEqual([...ModuleStatusSchema.options].sort());
    expect(MODULE_STATUS_LABEL.in_progress).toBe("In progress");
    expect(MODULE_STATUS_LABEL.planned).toBe("Planned");
    expect(MODULE_STATUSES).toEqual(ModuleStatusSchema.options);
  });

  it("maps statuses to StatusDot variants", () => {
    expect(moduleStatusVariant("backlog")).toBe("neutral");
    expect(moduleStatusVariant("planned")).toBe("neutral");
    expect(moduleStatusVariant("in_progress")).toBe("accent");
    expect(moduleStatusVariant("paused")).toBe("warning");
    expect(moduleStatusVariant("completed")).toBe("success");
    expect(moduleStatusVariant("cancelled")).toBe("error");
  });

  it("recognises status values", () => {
    expect(isModuleStatus("paused")).toBe(true);
    expect(isModuleStatus("done")).toBe(false);
  });

  it("keeps the archivable statuses equal to the engine's", () => {
    expect([...ARCHIVABLE_STATUSES].sort()).toEqual([...ARCHIVABLE_MODULE_STATUSES].sort());
    expect(canArchiveModule("completed")).toBe(true);
    expect(canArchiveModule("cancelled")).toBe(true);
    expect(canArchiveModule("in_progress")).toBe(false);
    expect(canArchiveModule("planned")).toBe(false);
  });
});

describe("formatModuleRange", () => {
  it("formats both dates, one date or none", () => {
    expect(formatModuleRange("2026-03-01", "2026-03-14")).toBe(`${formatShortDate("2026-03-01")} – ${formatShortDate("2026-03-14")}`);
    expect(formatModuleRange("2026-03-01", null)).toBe(`From ${formatShortDate("2026-03-01")}`);
    expect(formatModuleRange(null, "2026-03-14")).toBe(`Until ${formatShortDate("2026-03-14")}`);
    expect(formatModuleRange(null, null)).toBe("No dates");
  });

  it("uses the short month format", () => {
    expect(formatModuleRange("2026-03-01", "2026-03-14")).toMatch(/^Mar 1(, 2026)? – Mar 14(, 2026)?$/);
  });
});

describe("module progress", () => {
  it("counts completed against total minus cancelled", () => {
    const counts = { total: 10, completed: 3, cancelled: 2 };
    expect(moduleProgressValues(counts)).toEqual({ value: 3, max: 8 });
    expect(moduleProgressText(counts)).toBe("3/8");
    expect(moduleProgressText({ total: 0, completed: 0, cancelled: 0 })).toBe("0/0");
  });

  it("gives a cycle row the progress panel's numbers (CycleRow reads the list summary through it)", () => {
    // A cycle of 8 with 2 completed and 1 cancelled: the panel says "2 of 7", so the row says "2/7", not "2/8".
    const summary: CycleProgressSummary = { total: 8, completed: 2, cancelled: 1 };
    expect(moduleProgressValues(summary)).toEqual({ value: 2, max: 7 });
    expect(moduleProgressText(summary)).toBe("2/7");
  });
});

describe("moduleActions", () => {
  it("offers Edit, a disabled Archive and Delete on an open module", () => {
    const actions = moduleActions({ status: "in_progress", archived_at: null });
    expect(actions.map((action) => action.id)).toEqual(["edit", "archive", "delete"]);
    const archive = actions.find((action) => action.id === "archive");
    expect(archive?.isDisabled).toBe(true);
    expect(archive?.description).toBe(ARCHIVE_BLOCKED_REASON);
    expect(ARCHIVE_BLOCKED_REASON).toBe("Set the status to Completed or Cancelled first");
    expect(actions.find((action) => action.id === "delete")?.variant).toBe("destructive");
  });

  it("enables Archive for completed and cancelled modules", () => {
    for (const status of ["completed", "cancelled"] as const) {
      const actions = moduleActions({ status, archived_at: null });
      // The entry must exist first: a missing Archive would pass the falsy checks below.
      expect(actions.map((action) => action.id)).toEqual(["edit", "archive", "delete"]);
      const archive = actions.find((action) => action.id === "archive");
      expect(archive).toMatchObject({ id: "archive", label: "Archive" });
      expect(archive?.isDisabled).toBeFalsy();
      expect(archive?.description).toBeUndefined();
    }
  });

  it("offers only Restore and Delete on an archived module", () => {
    const actions = moduleActions({ status: "completed", archived_at: "2026-10-11T10:00:00.000Z" });
    expect(actions.map((action) => action.id)).toEqual(["restore", "delete"]);
    expect(actions.map((action) => action.label)).toEqual(["Restore", "Delete…"]);
  });
});

describe("moduleDateError", () => {
  it("returns the engine's date message with plain field names", () => {
    const details = [{ code: "custom", path: ["target_date"], message: "target_date must be on or after start_date" }];
    expect(moduleDateError(details)).toBe("Target date must be on or after start date");
  });

  it("accepts start_date issues", () => {
    expect(moduleDateError([{ path: ["start_date"], message: "expected a real calendar date" }])).toBe("Expected a real calendar date");
  });

  it("ignores other fields and malformed details", () => {
    expect(moduleDateError([{ path: ["name"], message: "Too long" }])).toBeNull();
    expect(moduleDateError({ id: "x" })).toBeNull();
    expect(moduleDateError(undefined)).toBeNull();
    expect(moduleDateError([null, "x"])).toBeNull();
  });
});

describe("changedModuleFields", () => {
  const before = {
    name: "Launch",
    description_md: "",
    status: "planned" as const,
    lead_actor_id: null,
    start_date: "2026-10-11",
    target_date: null,
  };

  it("returns only the fields that changed", () => {
    expect(changedModuleFields(before, { ...before })).toEqual({});
    expect(changedModuleFields(before, { ...before, name: "Launch 2", target_date: "2026-11-10" })).toEqual({ name: "Launch 2", target_date: "2026-11-10" });
    expect(changedModuleFields(before, { ...before, start_date: null })).toEqual({ start_date: null });
  });
});

describe("helpers", () => {
  it("compares member sets regardless of order", () => {
    expect(sameMembers(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameMembers(["a"], ["a", "b"])).toBe(false);
    expect(sameMembers([], [])).toBe(true);
  });

  it("accepts absolute http(s) URLs only", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com/a?b=c")).toBe(true);
    expect(isHttpUrl("example.com")).toBe(false);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("http:example.com")).toBe(false);
  });
});
