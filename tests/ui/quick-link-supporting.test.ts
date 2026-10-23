/**
 * The supporting line of a quick link card (W13, src/components/home/home-format.ts):
 * the host of an absolute URL, the path of an internal one; with no title the
 * title already shows the host or path, so the line names the address instead.
 */
import { describe, expect, it } from "vitest";
import { quickLinkSupporting } from "@/components/home/home-format";

describe("quickLinkSupporting", () => {
  it("shows the host under a titled external link", () => {
    expect(quickLinkSupporting({ title: "Staging", url: "https://staging.example.com/app?x=1" })).toBe("staging.example.com");
  });

  it("shows the path under a titled internal link", () => {
    expect(quickLinkSupporting({ title: "Analytics", url: "/analytics" })).toBe("/analytics");
  });

  it("does not repeat the title when there is none", () => {
    expect(quickLinkSupporting({ title: "", url: "https://example.com/docs" })).toBe("example.com/docs");
    expect(quickLinkSupporting({ title: "  ", url: "/stickies" })).toBe("In Tessera");
  });
});
