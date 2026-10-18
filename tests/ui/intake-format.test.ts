import { describe, expect, it } from "vitest";
import { nextOpenItem, sourceLabel, statusToken } from "@/components/intake/intake-format";

describe("intake format", () => {
  it("names sources and status tokens", () => {
    expect(sourceLabel("in_app")).toBe("In app");
    expect(sourceLabel("mcp")).toBe("MCP");
    expect(statusToken({ status: "pending", snoozed_till: null, duplicate_to: null })).toBeNull();
    expect(statusToken({ status: "declined", snoozed_till: null, duplicate_to: null })).toBe("Declined");
    expect(statusToken({ status: "duplicate", snoozed_till: null, duplicate_to: { id: "a", key: "WEB-1", name: "Fix" } })).toBe("Duplicate of WEB-1");
    expect(statusToken({ status: "snoozed", snoozed_till: "2026-10-18T12:00:00.000Z", duplicate_to: null })).toBe("Snoozed until 2026-10-18");
  });

  it("picks the next open item, then the previous one", () => {
    expect(nextOpenItem(["a", "b", "c"], "b")).toBe("c");
    expect(nextOpenItem(["a", "b"], "b")).toBe("a");
    expect(nextOpenItem(["a"], "a")).toBeNull();
  });
});
