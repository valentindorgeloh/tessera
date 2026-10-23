/**
 * Layout rules that Astryx props do not cover, read from the stylesheets
 * (jsdom does not run CSS layout, so the browser checks in the lane report cover
 * the pixels): the detail heading keeps no bottom padding, the narrow project
 * header gives the tabs their own row below 600px, and the top bar's search field
 * fills the centre slot there (src/components/styles/{detail,shell}.css).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function css(name: string): string {
  return readFileSync(path.join(process.cwd(), "src/components/styles", name), "utf8");
}

/** The declarations of the first rule whose selector is exactly `selector`, after stripping comments. */
function ruleBody(source: string, selector: string): string {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = stripped.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  return stripped.slice(start + selector.length + 2, stripped.indexOf("}", start));
}

describe("detail heading spacing", () => {
  it("has no padding under the title: the main column's own top padding is the only gap", () => {
    const heading = ruleBody(css("detail.css"), ".tessera-detail-heading");
    expect(heading).toMatch(/padding-block:\s*var\(--spacing-5\)\s+0\s*;/);
    const main = ruleBody(css("detail.css"), ".tessera-detail-main");
    expect(main).toMatch(/padding-block:\s*var\(--spacing-5\)\s+var\(--spacing-10\)\s*;/);
  });

  it("says nothing about symmetric padding", () => {
    expect(css("detail.css").toLowerCase()).not.toContain("symmetric");
  });
});

describe("narrow project header", () => {
  const shell = css("shell.css");
  const narrow = shell;

  it("puts the section menu on a second full-width grid row below 600px, the tabs on it from 600px", () => {
    expect(shell).toContain("@media (max-width: 599px)");
    expect(narrow).toMatch(/"token title end"\s+"tabs tabs tabs"/);
    expect(narrow).toMatch(/\.tessera-project-bar \.tessera-project-tabs\s*\{[^}]*grid-area:\s*tabs/);
    expect(narrow).toMatch(/\.tessera-project-bar \.tessera-section-menu\s*\{[^}]*grid-area:\s*tabs/);
    expect(narrow).toMatch(/\.tessera-project-bar > \.tessera-panel-bar-start\s*\{[^}]*display:\s*contents/);
  });
});

describe("drawer search field", () => {
  it("takes the whole centre slot below 600px", () => {
    const shell = css("shell.css");
    const index = shell.indexOf("@media (max-width: 599px)");
    expect(index).toBeGreaterThan(-1);
    expect(shell.slice(index, index + 200)).toMatch(/\.tessera-topbar-search\s*\{[^}]*width:\s*100%/);
  });
});
