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

  it("replaces the strip with the SectionMenu below 600px, in the second grid row, text on the 16px inset (decision 14)", () => {
    const phone = media("(max-width: 599px)", "tessera-section-menu");
    expect(phone).toMatch(/\.tessera-project-bar \.tessera-project-tabs\s*\{[^}]*display:\s*none/);
    expect(phone).toMatch(/\.tessera-project-bar \.tessera-section-menu\s*\{[^}]*grid-area:\s*tabs[^}]*margin-inline-start:\s*calc\(-1 \* var\(--spacing-3\)\)/);
    expect(phone).toMatch(/\.tessera-section-menu\s*\{[^}]*min-height:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-3\)\)/);
  });

  it("hides the SectionMenu from 600px up, in every panel bar (the band switch is CSS only)", () => {
    expect(media("(min-width: 600px)", "tessera-section-menu")).toMatch(/\.tessera-panel-bar \.tessera-section-menu\s*\{[^}]*display:\s*none/);
  });

  it("gives the folded tabs 44px boxes at a 44px pitch under a coarse pointer from 600 to 1279px, with no tiling", () => {
    const touch = media("(pointer: coarse) and (min-width: 600px) and (max-width: 1279px)", "tessera-project-tabs");
    expect(touch).toMatch(/\.tessera-project-tabs \.astryx-tab\s*\{[^}]*min-height:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-3\)\)/);
    expect(touch).toMatch(
      /\.tessera-project-tabs \.astryx-tab-strip\s*\{[^}]*column-gap:\s*var\(--spacing-1-5\);[^}]*padding-inline:\s*var\(--spacing-1\);[^}]*margin-inline:\s*calc\(-1 \* var\(--spacing-1\)\)/,
    );
  });

  it("no longer tiles hit areas or tightens the tab padding on a phone: the strip is not shown there", () => {
    expect(shell).not.toContain("tessera-project-tab-pad");
    expect(shell).not.toMatch(/\.tessera-project-tabs \.astryx-tab:not\(\[aria-current="true"\]\)::before/);
  });

  it("force-closes a folded tab's tooltip once the tab is current or the band is not folded", () => {
    const frame = readFileSync(path.join(process.cwd(), "src/components/work-items/ProjectFrame.tsx"), "utf8");
    expect(frame).toMatch(/isEnabled=\{isFoldBand && tab\.key !== active\?\.key\} isOpen=\{isFoldBand && tab\.key !== active\?\.key \? undefined : false\}/);
  });
});
