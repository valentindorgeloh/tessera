/**
 * Archive rules of the P3 archives UI (src/components/planning/archive-rules.ts):
 * which work items may be archived (the engine's `archive_open_item` rule),
 * the typed identifier that enables "Delete project", the archives tabs per
 * feature toggle, the active tab from the path, and the failure Toast text.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_OPEN_ITEM_REASON,
  activeArchiveKind,
  archiveTabs,
  canArchiveWorkItem,
  confirmsDelete,
  failureText,
} from "@/components/planning/archive-rules";
import { StateGroupSchema } from "@/lib/tessera/schemas";

const PROJECT = "11111111-1111-7111-8111-111111111111";

describe("canArchiveWorkItem", () => {
  it("allows completed and cancelled items only", () => {
    const allowed = StateGroupSchema.options.filter((group) => canArchiveWorkItem(group));
    expect(allowed).toEqual(["completed", "cancelled"]);
  });

  it("refuses an item whose state is unknown", () => {
    expect(canArchiveWorkItem(undefined)).toBe(false);
    expect(canArchiveWorkItem(null)).toBe(false);
  });

  it("names the rule in plain English", () => {
    expect(ARCHIVE_OPEN_ITEM_REASON).toBe("Only completed or cancelled work items can be archived");
  });
});

describe("confirmsDelete", () => {
  it("accepts the identifier exactly", () => {
    expect(confirmsDelete("WEB", "WEB")).toBe(true);
  });

  it("ignores case and surrounding spaces", () => {
    expect(confirmsDelete("WEB", "web")).toBe(true);
    expect(confirmsDelete("WEB", "  Web ")).toBe(true);
  });

  it("refuses an empty, partial, longer or different text", () => {
    expect(confirmsDelete("WEB", "")).toBe(false);
    expect(confirmsDelete("WEB", "WE")).toBe(false);
    expect(confirmsDelete("WEB", "WEB1")).toBe(false);
    expect(confirmsDelete("WEB", "W EB")).toBe(false);
    expect(confirmsDelete("P3T", "P3A")).toBe(false);
  });

  it("never confirms against an empty identifier", () => {
    expect(confirmsDelete("", "")).toBe(false);
    expect(confirmsDelete("  ", " ")).toBe(false);
  });
});

describe("archiveTabs", () => {
  const kinds = (cycles_enabled: boolean, modules_enabled: boolean) => archiveTabs({ cycles_enabled, modules_enabled }).map((tab) => tab.kind);

  it("lists work items, cycles and modules in that order", () => {
    expect(archiveTabs({ cycles_enabled: true, modules_enabled: true })).toEqual([
      { kind: "work-items", label: "Work items" },
      { kind: "cycles", label: "Cycles" },
      { kind: "modules", label: "Modules" },
    ]);
  });

  it("leaves out the tab of a feature that is turned off", () => {
    expect(kinds(false, true)).toEqual(["work-items", "modules"]);
    expect(kinds(true, false)).toEqual(["work-items", "cycles"]);
    expect(kinds(false, false)).toEqual(["work-items"]);
  });
});

describe("activeArchiveKind", () => {
  it("is the segment after archives/", () => {
    expect(activeArchiveKind(`/projects/${PROJECT}/archives/work-items`, PROJECT)).toBe("work-items");
    expect(activeArchiveKind(`/projects/${PROJECT}/archives/cycles`, PROJECT)).toBe("cycles");
    expect(activeArchiveKind(`/projects/${PROJECT}/archives/modules/`, PROJECT)).toBe("modules");
  });

  it("is empty on the archives root, another project or another section", () => {
    expect(activeArchiveKind(`/projects/${PROJECT}/archives`, PROJECT)).toBe("");
    expect(activeArchiveKind(`/projects/other/archives/cycles`, PROJECT)).toBe("");
    expect(activeArchiveKind(`/projects/${PROJECT}/cycles`, PROJECT)).toBe("");
    expect(activeArchiveKind("/projects/archives", PROJECT)).toBe("");
  });
});

describe("failureText", () => {
  it("appends the engine message as a sentence", () => {
    expect(failureText("Could not restore Sprint 1", 'The dates overlap cycle "Sprint 3"')).toBe('Could not restore Sprint 1. The dates overlap cycle "Sprint 3".');
  });

  it("keeps the message's own end punctuation and capitalises it", () => {
    expect(failureText("Could not restore WEB", "project WEB is not archived.")).toBe("Could not restore WEB. Project WEB is not archived.");
  });

  it("ends the subject when there is no message", () => {
    expect(failureText("Could not delete WEB-3", "  ")).toBe("Could not delete WEB-3.");
  });
});
