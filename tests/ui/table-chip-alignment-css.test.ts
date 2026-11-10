/**
 * A table row's resting chips and its armed controls sit at one height (properties/arming.tsx). A chip is an inline
 * button on the cell's text baseline; a chip that starts with a glyph (the priority glyph, the calendar icon) has a
 * baseline 4px lower than a text-first chip, so its line box is a pixel taller and the cell put it half a pixel higher
 * than the selectors, before and after the row armed. jsdom runs no layout, so the rule is pinned from the CSS text; the
 * measured proof is the browser check (chip and armed control at the same y, every row, both schemes, device scale 1
 * and 2).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src/components/styles/table.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every top-level rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const found: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((part) => part.trim());
    if (selectors.includes(selector)) found.push(match[2]);
  }
  return found.join("\n");
}

describe("table chip alignment", () => {
  it("centres a chip on its cell's line, so a glyph-first chip lands where a text-first one does", () => {
    expect(declarations(".tessera-table .tessera-wi-chip")).toMatch(/vertical-align:\s*middle/);
  });

  it("centres the wrapper Astryx puts around the armed date button the same way", () => {
    expect(declarations(".tessera-table .astryx-table-cell > div:has(> .tessera-wi-chip)")).toMatch(/vertical-align:\s*middle/);
  });
});
