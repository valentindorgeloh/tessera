/**
 * Shell fixes from the visual audit, read from the stylesheets and the theme
 * source because jsdom runs no CSS layout (S4, S8, S9, S10, S11, S12, S13, S14,
 * S15): the palette is pinned to the top, the sidebar rows reveal their menu on
 * hover only with a fine pointer, and the theme keeps the selected row's weight
 * and gives inverted surfaces their own hover overlay.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { autoHighlightRow, firstEnabledRow } from "@/components/shell/command-source";
import { projectMenuItems } from "@/components/shell/ProjectMenu";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const shell = strip(read("src/components/styles/shell.css"));

/** The text of the first block whose prelude contains `prelude`. */
function block(source: string, prelude: string): string {
  const start = source.indexOf(prelude);
  if (start < 0) throw new Error(`no block for ${prelude}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced block for ${prelude}`);
}

describe("sidebar layout (S8, S10)", () => {
  it("starts the New work item button's padding at 8px, so its icon sits on the rows' 16px", () => {
    expect(block(shell, ".tessera-sidebar-new {")).toMatch(/padding-inline-start:\s*var\(--spacing-2\)/);
  });

  it("puts 12px above the last, untitled group", () => {
    expect(block(shell, ".tessera-sidebar-last {")).toMatch(/margin-block-start:\s*var\(--spacing-3\)/);
  });
});

describe("sidebar row menus (S9)", () => {
  const fine = block(shell, "@media (hover: hover) and (min-width: 481px)");

  it("hides the menu with opacity only, and only with a fine pointer on a wide screen", () => {
    expect(block(fine, ".tessera-row-menu {")).toMatch(/opacity:\s*0/);
    expect(block(fine, ".tessera-row-menu {")).not.toMatch(/pointer-events/);
    // Outside the media query nothing hides the menu: touch and phones keep it.
    expect(shell.replace(fine, "")).not.toMatch(/\.tessera-row-menu\s*\{[^}]*opacity:\s*0/);
  });

  it("reveals it on hover, focus within and an open menu, and swaps the count out", () => {
    expect(fine).toMatch(/\.astryx-side-nav-item:is\(:hover, :focus-within\) \.tessera-row-menu/);
    expect(fine).toMatch(/\.tessera-row-menu:has\(\[aria-expanded="true"\]\)/);
    expect(fine).toMatch(/\.astryx-side-nav-item:is\(:hover, :focus-within\) \.tessera-row-count[^}]*\{\s*opacity:\s*0/);
  });

  it("stacks the count in the menu's place, ending 8px short of the slot edge", () => {
    expect(block(fine, ".tessera-row-actions > * {")).toMatch(/grid-area:\s*1 \/ 1/);
    expect(block(fine, ".tessera-row-count {")).toMatch(/margin-inline-end:\s*var\(--spacing-2\)/);
  });
});

describe("Power K position and footer (S4, S12)", () => {
  it("pins the palette dialog 80px from the top, 32px on a phone, with a matching height cap", () => {
    const rule = block(shell, ".astryx-dialog:has(.astryx-command-palette-input) {");
    expect(rule).toMatch(/--tessera-cmd-top:\s*calc\(var\(--spacing-12\) \+ var\(--spacing-8\)\)/);
    expect(rule).toMatch(/margin-block:\s*var\(--tessera-cmd-top\) auto/);
    expect(rule).toMatch(/max-block-size:\s*min\(calc\(var\(--spacing-12\) \* 10\), calc\(100dvh - 2 \* var\(--tessera-cmd-top\)\)\)/);
    const phone = block(shell, "@media (max-width: 599px) {\n  .astryx-dialog:has");
    expect(phone).toMatch(/--tessera-cmd-top:\s*var\(--spacing-8\)/);
  });

  it("hides the keyboard hints below 600px and keeps the All projects label on one line", () => {
    expect(shell).toMatch(/@media \(max-width: 599px\)\s*\{[\s\S]*?\.tessera-cmd-hints\s*\{\s*display:\s*none/);
    expect(block(shell, ".astryx-command-palette-footer .astryx-switch-field {")).toMatch(/white-space:\s*nowrap/);
  });

  it("highlights the first enabled row once results land", () => {
    expect(firstEnabledRow([])).toBe(-1);
    expect(firstEnabledRow([{ disabled: true }, {}, {}])).toBe(1);
    expect(firstEnabledRow([{}, {}])).toBe(0);
    expect(firstEnabledRow([{ disabled: true }])).toBe(-1);
  });

  it("auto-highlights only a typed query's landed results, never the idle empty-query list", () => {
    const rows = [{ disabled: true }, {}, {}];
    expect(autoHighlightRow("web", false, rows)).toBe(1);
    expect(autoHighlightRow("", false, rows)).toBe(-1);
    expect(autoHighlightRow("   ", false, rows)).toBe(-1);
    expect(autoHighlightRow("web", true, rows)).toBe(-1);
    expect(autoHighlightRow("web", false, [])).toBe(-1);
  });

  it("highlights once per query: a row the user un-highlights stays un-highlighted", () => {
    const parts = read("src/components/shell/palette-parts.tsx");
    expect(parts).toMatch(/autoHighlighted\.current = false;\s*setHighlighted\?\.\(-1\)/);
    expect(parts).toMatch(/if \(autoRow < 0 \|\| autoHighlighted\.current\) return;/);
  });
});

describe("sidebar rows and token-only CSS", () => {
  it("keeps touch-action none off the favourites and project rows (a finger scrolls the drawer)", () => {
    expect(strip(read("src/components/styles/favorites.css"))).not.toMatch(/touch-action:\s*none/);
  });

  it("writes the palette's height cap with tokens, no raw px", () => {
    expect(block(shell, ".astryx-dialog:has(.astryx-command-palette-input) {")).not.toMatch(/\d+px/);
  });
});

describe("project row menu (S13)", () => {
  const items = projectMenuItems({
    projectId: "p1",
    favoriteLabel: "Add to favorites",
    canMoveUp: true,
    canMoveDown: true,
    onCopyLink: () => {},
    onToggleFavorite: () => {},
    onArchive: () => {},
    onMove: () => {},
  });
  const ids = items.map((item) => ("type" in item && item.type === "divider" ? "---" : "id" in item ? item.id : "?"));

  it("separates navigation, link / favourite / draft, archive and the order", () => {
    expect(ids).toEqual(["settings", "archives", "---", "copy", "favorite", "draft", "---", "archive", "---", "up", "down"]);
  });
});

describe("not found (S15)", () => {
  it("balances the description's lines", () => {
    expect(block(shell, ".tessera-not-found .astryx-empty-state-description {")).toMatch(/text-wrap:\s*balance/);
  });
});

describe("theme (S11, S14)", () => {
  const theme = read("src/themes/catppuccin/catppuccinTheme.ts");
  const built = strip(read("src/themes/catppuccin/catppuccin.css"));

  it("keeps the selected sidebar row at the regular weight", () => {
    expect(theme).toMatch(/"side-nav-item": \{"selected:selected": \{fontWeight: "var\(--font-weight-normal\)"\}\}/);
    expect(block(built, '.astryx-side-nav-item[data-selected="selected"] {')).toMatch(/font-weight:\s*var\(--font-weight-normal\)/);
  });

  it("gives inverted surfaces their own hover and pressed overlay, so a toast's dismiss button shows a hover", () => {
    expect(block(built, '[data-astryx-media="dark"] {')).toMatch(/--color-overlay-hover:\s*color-mix\(in srgb, var\(--color-on-dark\) 10%, transparent\)/);
    expect(block(built, '[data-astryx-media="light"] {')).toMatch(/--color-overlay-hover:\s*color-mix\(in srgb, var\(--color-on-light\) 8%, transparent\)/);
  });
});

describe("header tab strips on a phone (S7)", () => {

  it("pulls the first tab's padding onto the 16px inset in every docked strip", () => {
    const pull = /width:\s*calc\(100% \+ var\(--spacing-3\)\)[^}]*margin-inline-start:\s*calc\(-1 \* var\(--spacing-3\)\)/;
    expect(block(shell, ".tessera-panel-bar-start > .astryx-tab-list:first-child {")).toMatch(/margin-inline-start:\s*calc\(-1 \* var\(--spacing-3\)\)/);
    expect(block(shell, ".tessera-panel-bar--tabs-below > .tessera-panel-bar-start > .astryx-tab-list {")).toMatch(pull);
    expect(block(shell, ".tessera-project-bar .tessera-project-tabs {")).toMatch(pull);
    // The inbox is a PanelBar tabsBelow like the profile and analytics: no strip rules of its own (inbox.css).
    expect(read("src/components/inbox/InboxScreen.tsx")).toMatch(/<PanelBar\s+tabsBelow\s+start=/);
  });
});
