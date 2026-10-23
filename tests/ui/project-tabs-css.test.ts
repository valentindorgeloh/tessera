/**
 * The project frame's eight tabs fit their strip at rest on a phone and a tablet
 * (decision 14): the bar takes two rows from 600 to 1279px, and below 1280px
 * only the current tab keeps its label. jsdom has no layout, so the rules are
 * read from src/components/styles/shell.css; the browser pass measures them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(path.join(process.cwd(), "src/components/styles/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `@media <prelude> { ... }` block whose body contains `needle`. */
function media(prelude: string, needle: string): string {
  let from = 0;
  for (;;) {
    const start = shell.indexOf(`@media ${prelude} {`, from);
    if (start < 0) throw new Error(`no ${prelude} block with ${needle}`);
    let depth = 0;
    let end = start;
    for (let i = shell.indexOf("{", start); i < shell.length; i++) {
      if (shell[i] === "{") depth++;
      if (shell[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = shell.slice(shell.indexOf("{", start) + 1, end);
    if (body.includes(needle)) return body;
    from = end;
  }
}

describe("project tabs on a phone and a tablet", () => {
  it("gives the bar the two-row grid from 600 to 1279px, with the strip on the second row", () => {
    const tablet = media("(min-width: 600px) and (max-width: 1279px)", "tessera-project-bar");
    expect(tablet).toMatch(/"token title end"\s+"tabs tabs tabs"/);
    expect(tablet).toMatch(/\.tessera-project-bar > \.tessera-panel-bar-start\s*\{[^}]*display:\s*contents/);
    expect(tablet).toMatch(/\.tessera-project-bar \.tessera-project-tabs\s*\{[^}]*grid-area:\s*tabs[^}]*max-width:\s*none/);
  });

  it("folds every tab but the current one to its icon below 1280px", () => {
    const narrow = media("(max-width: 1279px)", "aria-current");
    expect(narrow).toMatch(/\.tessera-project-tabs \.astryx-tab:not\(\[aria-current="true"\]\) > span:has\(> span\[aria-hidden="true"\]\)\s*\{[^}]*display:\s*none/);
  });

  it("tightens the tab padding to 6px, then 5px, then 4px, on a phone so eight tabs fit the strip", () => {
    const phone = media("(max-width: 480px)", "tessera-project-tab-pad");
    expect(phone).toMatch(/--tessera-project-tab-pad:\s*calc\(var\(--spacing-1\) \* 1\.5\)/);
    expect(phone).toMatch(/\.astryx-tab\s*\{[^}]*padding-inline:\s*var\(--tessera-project-tab-pad\)/);
    expect(media("(max-width: 374px)", "tessera-project-tab-pad")).toMatch(/--tessera-project-tab-pad:\s*calc\(var\(--spacing-1\) \* 1\.25\)/);
    expect(media("(max-width: 339px)", "tessera-project-tab-pad")).toMatch(/--tessera-project-tab-pad:\s*var\(--spacing-1\)/);
  });

  it("tiles the hit areas of the folded icon tabs on a phone (decision 14, option A)", () => {
    const touch = media("(pointer: coarse), (max-width: 480px)", "tessera-project-tabs");
    // Each folded icon owns its pitch (its width plus half of the 2px gap per side); the current tab keeps the theme's area.
    expect(touch).toMatch(
      /\.tessera-project-tabs \.astryx-tab:not\(\[aria-current="true"\]\)::before\s*\{[^}]*inset-inline:\s*calc\(var\(--spacing-0-5\) \/ -2\)/,
    );
  });
});
