/**
 * Entity link helpers of the description editor
 * (src/components/editor/links.ts): parse, build, allow-list and routes.
 */
import { describe, expect, it } from "vitest";
import { ENTITY_LINK_SCHEMES, entityHref, entityRoute, isAllowedEditorUri, parseEntityHref } from "@/components/editor/links";

const CYCLE_ID = "019505a0-7c5e-7000-8000-000000000001";

describe("parseEntityHref", () => {
  it("parses every entity scheme", () => {
    expect(parseEntityHref("work:WEB-12")).toEqual({ scheme: "work", ref: "WEB-12" });
    expect(parseEntityHref("page:spec-1")).toEqual({ scheme: "page", ref: "spec-1" });
    expect(parseEntityHref(`cycle:${CYCLE_ID}`)).toEqual({ scheme: "cycle", ref: CYCLE_ID });
    expect(parseEntityHref(`module:${CYCLE_ID}`)).toEqual({ scheme: "module", ref: CYCLE_ID });
  });

  it("lower-cases the scheme and trims the href", () => {
    expect(parseEntityHref("  Work:WEB-12 ")).toEqual({ scheme: "work", ref: "WEB-12" });
  });

  it("returns null for web links, unknown schemes and empty refs", () => {
    expect(parseEntityHref("https://example.com")).toBeNull();
    expect(parseEntityHref("mailto:a@b.c")).toBeNull();
    expect(parseEntityHref("issue:WEB-12")).toBeNull();
    expect(parseEntityHref("work:")).toBeNull();
    expect(parseEntityHref("work: ")).toBeNull();
    expect(parseEntityHref("WEB-12")).toBeNull();
    expect(parseEntityHref("")).toBeNull();
  });
});

describe("entityHref", () => {
  it("round-trips through parseEntityHref", () => {
    for (const scheme of ENTITY_LINK_SCHEMES) {
      const href = entityHref({ scheme, ref: "ref-1" });
      expect(href).toBe(`${scheme}:ref-1`);
      expect(parseEntityHref(href)).toEqual({ scheme, ref: "ref-1" });
    }
  });
});

describe("isAllowedEditorUri", () => {
  it("allows http, https and mailto", () => {
    expect(isAllowedEditorUri("https://example.com/path?q=1")).toBe(true);
    expect(isAllowedEditorUri("http://example.com")).toBe(true);
    expect(isAllowedEditorUri("mailto:nina@example.com")).toBe(true);
    expect(isAllowedEditorUri("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("allows the entity schemes by default and only those passed explicitly", () => {
    expect(isAllowedEditorUri("work:WEB-12")).toBe(true);
    expect(isAllowedEditorUri("page:spec-1")).toBe(true);
    expect(isAllowedEditorUri("work:WEB-12", ["page"])).toBe(false);
    expect(isAllowedEditorUri("page:spec-1", ["page"])).toBe(true);
  });

  it("accepts the Link extension's protocol objects", () => {
    expect(isAllowedEditorUri("work:WEB-12", [{ scheme: "work" }])).toBe(true);
    expect(isAllowedEditorUri("cycle:x", [{ scheme: "work" }, "module"])).toBe(false);
  });

  it("rejects scripts, data, scheme-less text and empty entity refs", () => {
    expect(isAllowedEditorUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedEditorUri("data:text/html;base64,AAAA")).toBe(false);
    expect(isAllowedEditorUri("example.com")).toBe(false);
    expect(isAllowedEditorUri("work:")).toBe(false);
    expect(isAllowedEditorUri("")).toBe(false);
  });
});

describe("entityRoute", () => {
  it("routes work items through /browse, cycles and modules through their alias routes, pages not yet", () => {
    expect(entityRoute({ scheme: "work", ref: "WEB-12" })).toBe("/browse/WEB-12");
    expect(entityRoute({ scheme: "work", ref: "a b" })).toBe("/browse/a%20b");
    expect(entityRoute({ scheme: "page", ref: "spec-1" })).toBeNull();
    expect(entityRoute({ scheme: "cycle", ref: CYCLE_ID })).toBe(`/cycles/${CYCLE_ID}`);
    expect(entityRoute({ scheme: "module", ref: CYCLE_ID })).toBe(`/modules/${CYCLE_ID}`);
    // The ref is encoded like a work item key, so an odd ref cannot change the path.
    expect(entityRoute({ scheme: "cycle", ref: "a/b" })).toBe("/cycles/a%2Fb");
  });
});
