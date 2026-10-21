/**
 * The page Outline never covers the reading column (decision 105, p10 "Page
 * outline"): outside the wide container query it is a stacked block in its own
 * grid row, not a sticky card sharing the column's cell. jsdom has no layout,
 * so this reads the stylesheet.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/components/styles/pages.css", "utf8");

function ruleBody(selector: string, source: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start));
}

describe("page outline layout", () => {
  const container = css.indexOf("@container (min-width: 1136px)");
  const narrow = css.slice(0, container);
  const wide = css.slice(container);

  it("stacks above the column in a narrow frame", () => {
    const outline = ruleBody(".tessera-page-outline", narrow);
    expect(outline).toContain("grid-row: 1");
    expect(outline).not.toContain("position: sticky");
    expect(outline).not.toContain("grid-area: 1 / 1");
    expect(ruleBody(".tessera-page-frame > .tessera-page", narrow)).toContain("grid-row: 2");
  });

  it("sits beside the column, sticky, in a wide frame", () => {
    const outline = ruleBody('.tessera-page-frame[data-outline="open"] > .tessera-page-outline', wide);
    expect(outline).toContain("grid-area: 1 / 3");
    expect(outline).toContain("position: sticky");
  });
});
