/**
 * Membership rules of the cycle and module property controls
 * (src/components/work-items/properties/membership-rules.ts): completed and
 * archived cycle values are read-only, archived module ids survive every change.
 */
import { describe, expect, it } from "vitest";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { archivedModulesLabel, cycleControlModel, mergeModuleChange, moduleControlOptions, splitModuleValue } from "@/components/work-items/properties/membership-rules";
import type { Cycle } from "@/lib/tessera/types";

const CURRENT = "11111111-1111-7111-8111-111111111111";
const UPCOMING = "22222222-2222-7222-8222-222222222222";
const COMPLETED = "33333333-3333-7333-8333-333333333333";
const ARCHIVED = "44444444-4444-7444-8444-444444444444";

const cycles: Pick<Cycle, "id" | "name" | "status" | "archived_at">[] = [
  { id: CURRENT, name: "Sprint 2", status: "current", archived_at: null },
  { id: UPCOMING, name: "Sprint 3", status: "upcoming", archived_at: null },
  { id: COMPLETED, name: "Sprint 1", status: "completed", archived_at: null },
];

const MODULE_A = "a0000000-0000-7000-8000-00000000000a";
const MODULE_B = "a0000000-0000-7000-8000-00000000000b";
const MODULE_GONE = "a0000000-0000-7000-8000-00000000000c";
const modules = [{ id: MODULE_A }, { id: MODULE_B }];

describe("cycleControlModel", () => {
  it("keeps an open value editable and leaves completed cycles out of the options", () => {
    const model = cycleControlModel(CURRENT, cycles);
    expect(model.readOnly).toBe(false);
    expect(model.reason).toBeNull();
    expect(model.options).toEqual([
      { value: CURRENT, label: "Sprint 2", description: "Current" },
      { value: UPCOMING, label: "Sprint 3", description: "Upcoming" },
    ]);
  });

  it("offers the open cycles for an item without a cycle", () => {
    const model = cycleControlModel(null, cycles);
    expect(model).toMatchObject({ readOnly: false, reason: null });
    expect(model.options.map((option) => option.value)).toEqual([CURRENT, UPCOMING]);
  });

  it("makes a completed value read-only and keeps it as an option", () => {
    const model = cycleControlModel(COMPLETED, cycles);
    expect(model).toMatchObject({ readOnly: true, reason: "completed" });
    expect(model.options).toContainEqual({ value: COMPLETED, label: "Sprint 1", description: "Completed" });
  });

  it("leaves an archived cycle out of the options and makes it read-only as a value", () => {
    const archived = { id: ARCHIVED, name: "Sprint 0", status: "upcoming" as const, archived_at: "2026-03-01T00:00:00.000Z" };
    const withArchived = [...cycles, archived];
    expect(cycleControlModel(null, withArchived).options.map((option) => option.value)).toEqual([CURRENT, UPCOMING]);
    expect(cycleControlModel(ARCHIVED, withArchived)).toMatchObject({ readOnly: true, reason: "archived" });
  });

  it("makes an archived (missing) value read-only with a synthetic option", () => {
    const model = cycleControlModel(ARCHIVED, cycles);
    expect(model).toMatchObject({ readOnly: true, reason: "archived" });
    expect(model.options).toContainEqual({ value: ARCHIVED, label: "Archived cycle", description: "Archived" });
    expect(model.options.some((option) => option.value === COMPLETED)).toBe(false);
  });
});

describe("splitModuleValue and mergeModuleChange", () => {
  it("splits the ids the bundle knows from the archived ones", () => {
    expect(splitModuleValue([MODULE_A, MODULE_GONE], modules)).toEqual({ editable: [MODULE_A], kept: [MODULE_GONE] });
    expect(splitModuleValue([], modules)).toEqual({ editable: [], kept: [] });
  });

  it("keeps the archived ids when an editable module is added", () => {
    const { editable, kept } = splitModuleValue([MODULE_A, MODULE_GONE], modules);
    expect(mergeModuleChange([...editable, MODULE_B], kept)).toEqual([MODULE_A, MODULE_B, MODULE_GONE]);
  });

  it("keeps the archived ids when every editable module is removed", () => {
    const { kept } = splitModuleValue([MODULE_A, MODULE_GONE], modules);
    expect(mergeModuleChange([], kept)).toEqual([MODULE_GONE]);
  });

  it("passes the value through unchanged without kept ids", () => {
    const { editable, kept } = splitModuleValue([MODULE_B, MODULE_A], modules);
    expect(kept).toEqual([]);
    expect(mergeModuleChange(editable, kept)).toEqual([MODULE_B, MODULE_A]);
    expect(mergeModuleChange([MODULE_A], [])).toEqual([MODULE_A]);
  });

  it("counts the archived modules in the read-only token", () => {
    expect(archivedModulesLabel(1)).toBe("1 archived module");
    expect(archivedModulesLabel(3)).toBe("3 archived modules");
  });
});

describe("moduleControlOptions", () => {
  it("offers open modules only", () => {
    const options = moduleControlOptions([
      { id: MODULE_A, name: "Launch", archived_at: null },
      { id: MODULE_B, name: "Old", archived_at: "2026-03-01T00:00:00.000Z" },
    ]);
    expect(options).toEqual([{ value: MODULE_A, label: "Launch" }]);
  });
});

describe("formatShortDate", () => {
  it("leaves the year out inside today's year and shows it outside", () => {
    expect(formatShortDate("2026-11-10", "2026-03-10")).toBe("Nov 10");
    expect(formatShortDate("2027-01-10", "2026-03-10")).toBe("Jan 10, 2027");
    expect(formatShortDate("2025-12-31", "2026-03-10")).toBe("Dec 31, 2025");
  });
});
