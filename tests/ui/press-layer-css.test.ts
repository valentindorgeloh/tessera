/**
 * Press feedback on an Astryx button (src/components/styles/shell.css), read from
 * the stylesheet because jsdom runs no CSS layout. Under a coarse pointer Astryx
 * 0.7.9-0.7.11 paints a pressed button's tint on the button's `::before`, which is
 * also where Tessera's 44px hit areas live (the theme's `button` target and the
 * area rules in shell.css, planning.css and detail.css). The theme layer and the
 * product CSS outrank Astryx's layer, so without this rule the tint stretched to
 * the whole hit area. tests/e2e/coverage-touch.spec.ts proves the hit areas still hit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src/components/styles/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("press feedback on a button", () => {
  it("takes the button's own box again while a press runs, inside the touch media query", () => {
    const query = css.indexOf("@media (pointer: coarse), (max-width: 480px) {");
    const rule = css.indexOf(".astryx-button[data-astryx-press]::before {");
    expect(query, "the touch media query").toBeGreaterThan(-1);
    expect(rule, "a rule for the pressed button").toBeGreaterThan(query);
    const body = css.slice(rule, css.indexOf("}", rule));
    expect(body).toContain('content: "" !important');
    expect(body).toContain("inset: 0 !important");
  });
});
