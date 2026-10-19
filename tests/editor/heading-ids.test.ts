/**
 * Heading slug and unique id helpers for the page Outline.
 */
import { describe, expect, it } from "vitest";
import { headingSlug, uniqueHeadingId } from "@/components/editor/heading-ids";

describe("headingSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(headingSlug("Hello World")).toBe("hello-world");
    expect(headingSlug("  API Reference  ")).toBe("api-reference");
  });

  it("strips accents and punctuation", () => {
    expect(headingSlug("Café & Tea!")).toBe("cafe-tea");
  });

  it("falls back for empty text", () => {
    expect(headingSlug("")).toBe("heading");
    expect(headingSlug("!!!")).toBe("heading");
  });
});

describe("uniqueHeadingId", () => {
  it("dedupes colliding slugs", () => {
    const used = new Set<string>();
    expect(uniqueHeadingId("intro", used)).toBe("intro");
    expect(uniqueHeadingId("intro", used)).toBe("intro-2");
    expect(uniqueHeadingId("intro", used)).toBe("intro-3");
  });
});
