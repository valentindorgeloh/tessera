/**
 * The property helpers leaf module (src/components/work-items/properties/option-helpers.ts): it carries no client
 * directive and imports no Astryx component as a value, so the home widget, the planning panels and the page meta can
 * take the state group and label helpers without the selectors and date pickers of the control files; the control
 * files and the barrel re-export the same functions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as barrel from "@/components/work-items/properties";
import * as helpers from "@/components/work-items/properties/option-helpers";

const source = readFileSync("src/components/work-items/properties/option-helpers.ts", "utf8");

describe("option-helpers.ts", () => {
  it("has no client directive and only type imports from Astryx", () => {
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    const astryxImports = source.split("\n").filter((line) => /from "@astryxdesign\//.test(line));
    expect(astryxImports.length).toBeGreaterThan(0);
    for (const line of astryxImports) expect(line).toMatch(/^import type /);
  });

  it("is what the barrel re-exports", () => {
    expect(barrel.stateGroupLabel).toBe(helpers.stateGroupLabel);
    expect(barrel.stateGroupVariant).toBe(helpers.stateGroupVariant);
    expect(barrel.PRIORITY_OPTIONS).toBe(helpers.PRIORITY_OPTIONS);
    expect(barrel.isPriority).toBe(helpers.isPriority);
    expect(barrel.priorityOption).toBe(helpers.priorityOption);
    expect(barrel.paletteTokenColor).toBe(helpers.paletteTokenColor);
  });

  it("keeps the helpers' behaviour", () => {
    expect(helpers.stateGroupLabel("unstarted")).toBe("Not started");
    expect(helpers.stateGroupVariant("started")).toBe("accent");
    expect(helpers.priorityOption("urgent").label).toBe("Urgent");
    expect(helpers.priorityOption("bogus").value).toBe("none");
    expect(helpers.isPriority("high")).toBe(true);
    expect(helpers.isPriority("bogus")).toBe(false);
    expect(helpers.paletteTokenColor(null)).toBe("gray");
    expect(helpers.paletteTokenColor("blue")).toBe("blue");
  });
});
