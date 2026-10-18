/**
 * Pure helpers for Home, stickies and workspace settings
 * (src/components/home/home-format.ts, settings-format.ts, RecentsList).
 */
import { describe, expect, it } from "vitest";
import {
  editableWidgets,
  entityId,
  fieldWords,
  isHomeWidgetId,
  isIsoTimestamp,
  isQuickLinkUrl,
  moveWidget,
  parseHomeSeenSeq,
  quickLinkLabel,
  sinceDescription,
  sinceRowLabel,
  stickyColorClass,
  stickyPreview,
  stickyTitle,
  type SinceEntry,
} from "@/components/home/home-format";
import { filterRecents } from "@/components/shell/RecentsList";
import { digestsEnabled, isSettingsTab, workspaceNameError } from "@/components/workspace-settings/settings-format";

function entry(overrides: Partial<SinceEntry> = {}): SinceEntry {
  return {
    actor: { id: "actor", name: "Ada", kind: "agent", color: "teal" },
    target: { type: "work_item", id: "item", label: "Design review", href: "/browse/WEB-1" },
    verbs: ["updated"],
    fields: ["state_id"],
    count: 1,
    last_at: "2026-10-18T12:00:00.000Z",
    last_seq: 4,
    ...overrides,
  };
}

describe("since rows", () => {
  it("names the actor, the activity phrase and the target", () => {
    expect(sinceRowLabel(entry())).toBe("Ada changed the state Design review");
  });

  it("replaces 'this work item' with the target name", () => {
    expect(sinceRowLabel(entry({ verbs: ["created"], fields: [] }))).toBe("Ada created Design review");
  });

  it("mentions further verbs collapsed into the row", () => {
    expect(sinceRowLabel(entry({ verbs: ["updated", "added"], fields: ["state_id"], count: 2 }))).toBe("Ada changed the state (1 more change) Design review");
  });

  it("lists the fields and the collapsed count", () => {
    expect(sinceDescription(["state_id", "priority", "state_id"], 2)).toBe("state, priority · 2 changes");
    expect(sinceDescription([], 1)).toBe("1 change");
    expect(fieldWords("description_md")).toBe("description");
    expect(fieldWords("custom_field")).toBe("custom field");
  });
});

describe("quick links", () => {
  it("accepts http(s) URLs and app paths", () => {
    expect(isQuickLinkUrl("https://example.com/docs")).toBe(true);
    expect(isQuickLinkUrl("http://example.com")).toBe(true);
    expect(isQuickLinkUrl("/inbox")).toBe(true);
    expect(isQuickLinkUrl("/")).toBe(true);
  });

  it("rejects other schemes, protocol-relative URLs and spaces", () => {
    expect(isQuickLinkUrl("//evil.example")).toBe(false);
    expect(isQuickLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isQuickLinkUrl("ftp://example.com")).toBe(false);
    expect(isQuickLinkUrl("example.com")).toBe(false);
    expect(isQuickLinkUrl("/foo bar")).toBe(false);
    expect(isQuickLinkUrl("")).toBe(false);
  });

  it("shows the title, else the host, else the path", () => {
    expect(quickLinkLabel({ title: "  Docs  ", url: "https://example.com/a" })).toBe("Docs");
    expect(quickLinkLabel({ title: "", url: "https://example.com/a" })).toBe("example.com");
    expect(quickLinkLabel({ title: "", url: "/inbox" })).toBe("/inbox");
  });
});

describe("home widgets", () => {
  it("keeps stored order and appends a missing widget shown", () => {
    expect(editableWidgets([{ widget: "stickies", enabled: false }, { widget: "nope", enabled: true }])).toEqual([
      { widget: "stickies", enabled: false },
      { widget: "since_last_visit", enabled: true },
      { widget: "quick_links", enabled: true },
      { widget: "recents", enabled: true },
      { widget: "your_work", enabled: true },
    ]);
    expect(isHomeWidgetId("recents")).toBe(true);
    expect(isHomeWidgetId("projects")).toBe(false);
  });

  it("swaps a widget with its neighbour and leaves the ends alone", () => {
    const widgets = ["a", "b", "c"];
    expect(moveWidget(widgets, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveWidget(widgets, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveWidget(widgets, 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("recents filter", () => {
  const rows = [
    { icon: "work-item", path: "/work" },
    { icon: "page", path: "/pages/1" },
    { icon: "projects", path: "/projects" },
    { icon: "work-items", path: "/projects/p/work-items" },
  ];

  it("keeps every icon when the filter is all, then applies the limit", () => {
    expect(filterRecents(rows, "all", 2).map((row) => row.path)).toEqual(["/work", "/pages/1"]);
  });

  it("matches work items, pages and projects by route icon", () => {
    expect(filterRecents(rows, "work-items", 8).map((row) => row.icon)).toEqual(["work-item", "work-items"]);
    expect(filterRecents(rows, "pages", 8).map((row) => row.path)).toEqual(["/pages/1"]);
    expect(filterRecents(rows, "projects", 8).map((row) => row.path)).toEqual(["/projects"]);
    expect(filterRecents(rows, "pages", 0)).toEqual([]);
  });
});

describe("stickies", () => {
  it("previews the first readable line", () => {
    expect(stickyPreview("# Hello\n\nworld")).toBe("Hello");
    expect(stickyPreview("See [the spec](https://example.com).")).toBe("See the spec.");
    expect(stickyPreview("")).toBe("");
    expect(stickyTitle("  ")).toBe("Untitled sticky");
    expect(stickyTitle("Standup")).toBe("Standup");
    expect(stickyColorClass("teal")).toBe("tessera-sticky tessera-sticky--teal");
    expect(stickyColorClass("nope")).toBe("tessera-sticky tessera-sticky--yellow");
  });
});

describe("home seen and settings", () => {
  it("reads a non-negative integer seq", () => {
    expect(parseHomeSeenSeq({ seq: 4 })).toBe(4);
    expect(parseHomeSeenSeq({ seq: 0 })).toBe(0);
    expect(parseHomeSeenSeq({ seq: -1 })).toBeNull();
    expect(parseHomeSeenSeq({ seq: 1.5 })).toBeNull();
    expect(parseHomeSeenSeq({})).toBeNull();
    expect(parseHomeSeenSeq(null)).toBeNull();
    expect(isIsoTimestamp("2026-10-18T12:00:00.000Z")).toBe(true);
    expect(isIsoTimestamp("yesterday")).toBe(false);
    expect(isIsoTimestamp(null)).toBe(false);
  });

  it("reads an entity id off a tool result", () => {
    expect(entityId({ id: "abc" })).toBe("abc");
    expect(entityId({ id: "" })).toBeNull();
    expect(entityId(null)).toBeNull();
  });

  it("checks the workspace name and the settings tabs", () => {
    expect(workspaceNameError("  ")).toBe("A name is required");
    expect(workspaceNameError("Tessera")).toBeNull();
    expect(workspaceNameError("x".repeat(81))).toBe("Use 80 characters or fewer");
    expect(isSettingsTab("general")).toBe(true);
    expect(isSettingsTab("ai")).toBe(true);
    expect(isSettingsTab("exports")).toBe(true);
    expect(isSettingsTab("webhooks")).toBe(true);
    expect(isSettingsTab("features")).toBe(false);
    expect(digestsEnabled({ ai: null })).toBe(true);
    expect(digestsEnabled({ ai: { digest_enabled: false } })).toBe(false);
  });
});
