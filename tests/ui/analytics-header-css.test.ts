/**
 * The analytics header (docs/contracts/ui.md "Panel headers", S7), read from the
 * source and the stylesheet (jsdom runs no layout): it uses `tabsBelow` without
 * `canWrap` (PanelHeader documents the pair as unsupported, and the wrapped row
 * left the tab strip 32px above the hairline between 600 and 1100px), and
 * analytics.css makes it a two-row grid below 1100px so the strip docks on the
 * bar's bottom hairline at every width.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("analytics header", () => {
  it("combines tabsBelow with no canWrap", () => {
    const screen = read("src/components/analytics/AnalyticsScreen.tsx");
    const bar = /<PanelBar\b[\s\S]*?start=/.exec(screen)?.[0] ?? "";
    expect(bar).toMatch(/\btabsBelow\b/);
    expect(bar).not.toMatch(/\bcanWrap\b/);
  });

  it("is a title / end then tabs grid below 1100px, with the strip at the bottom edge", () => {
    const css = read("src/components/styles/analytics.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = /@media \(max-width: 1099px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/display:\s*grid/);
    expect(block).toMatch(/"title end"\s*"tabs tabs"/);
    expect(block).toMatch(/\.astryx-tab-list\s*\{[^}]*grid-area:\s*tabs;[^}]*align-self:\s*end/);
    expect(block).toMatch(/\.tessera-panel-bar-end\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
