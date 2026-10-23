/**
 * Visual-audit fixes of the detail lane, second pass (docs/contracts/ui.md
 * "Detail components", decision 14), read from the stylesheets and components
 * because jsdom runs no layout: the reaction picker wraps under touch, the
 * proposal chip keeps its word, a clamped relation name does not wrap its row,
 * multi-select options and relation hits reach 44px, the tool-call disclosure
 * gets a hit area, and the sub-item input fills its row.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const collaboration = strip(read("src/components/styles/collaboration.css"));
const detail = strip(read("src/components/styles/detail.css"));
const aiPanel = strip(read("src/components/styles/ai-panel.css"));
const TOUCH = "@media (pointer: coarse), (max-width: 480px)";

/** The body of the first rule with exactly this selector; with `inTouch`, the one inside a touch media block (the last match). */
function rule(css: string, selector: string, inTouch = false): string {
  const pattern = new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  const matches = [...css.matchAll(pattern)];
  const match = inTouch ? matches.at(-1) : matches[0];
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

describe("reaction picker", () => {
  it("wraps into columns under touch so the eighth emoji stays on screen", () => {
    expect(collaboration).toContain(TOUCH);
    const picker = rule(collaboration, ".tessera-reaction-picker", true);
    expect(picker).toMatch(/flex-wrap:\s*wrap/);
    expect(picker).toMatch(/max-inline-size:\s*calc\(var\(--size-element-md\) \* 4/);
    expect(picker).toMatch(/gap:\s*var\(--spacing-2\)/);
  });
});

describe("relation and sub-item rows", () => {
  it("gives a one-line name the 10rem floor as its flex basis, so a long title does not wrap the row", () => {
    expect(rule(detail, ".tessera-detail-row-name--clamp")).toMatch(/flex:\s*1 1 min\(10rem, 100%\)/);
    for (const file of ["src/components/detail/RelationsList.tsx", "src/components/detail/SubItems.tsx"]) {
      expect(read(file)).toContain("tessera-detail-row-name tessera-detail-row-name--clamp");
    }
  });

  it("sets a real width on the new sub-item input (\"fill\" is not a CSS width)", () => {
    const source = read("src/components/detail/SubItems.tsx");
    expect(source).toContain('width="100%"');
    expect(source).not.toContain('width="fill"');
  });
});

describe("touch targets in the detail popovers and dialogs", () => {
  it("makes multi-select option rows and relation search results 44px under touch", () => {
    expect(rule(detail, ".astryx-multi-selector-option", true)).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(rule(detail, ".tessera-relation-hits .astryx-list-item > button", true)).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(read("src/components/detail/RelationsList.tsx")).toContain('className="tessera-relation-hits"');
  });

  it("returns focus to Add relation after the dialog closes and after a removal", () => {
    const source = read("src/components/detail/RelationsList.tsx");
    expect(source).toContain("ref={addButtonRef}");
    expect(source).toMatch(/wasAdding\.current && !adding\) addButtonRef\.current\?\.focus\(\)/);
    expect(source).toMatch(/const remove = [^{]*\{\s*addButtonRef\.current\?\.focus\(\);/);
  });
});

describe("assistant panel", () => {
  it("keeps the proposal status chip at its full width and lets the title wrap", () => {
    expect(rule(aiPanel, ".tessera-ai-proposal-head > .astryx-token")).toMatch(/flex:\s*none/);
    expect(rule(aiPanel, ".tessera-ai-proposal-title")).toMatch(/min-width:\s*0/);
    expect(read("src/components/ai/ProposalRow.tsx")).toContain('className="tessera-ai-proposal-head"');
  });

  it("gives the tool-call disclosure a 44px block-axis hit area under touch", () => {
    const hit = rule(aiPanel, '.tessera-ai-panel .astryx-chat-tool-calls > [role="button"]::before', true);
    expect(hit).toMatch(/inset-block:\s*min\(0px, calc\(\(100% - var\(--spacing-11\)\) \/ 2\)\)/);
    expect(hit).toMatch(/inset-inline:\s*0/);
  });
});
