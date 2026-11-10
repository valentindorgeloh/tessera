/**
 * Board and table stylesheet rules of the visual audit (lane board-table), read from the CSS text because jsdom runs
 * no layout: a card is no whole-card touch grip (only the grip has `touch-action: none`), the strip snaps hard on a
 * phone, a card's menu is quiet until hover or focus (and always on where there is no hover), the swimlane heads and
 * lane bars stick, the table header sticks (its wrapper no longer clips), and the 44px touch rules exist only under
 * "(pointer: coarse), (max-width: 480px)" so the 1440 density (rows 37px, header 29.5px) is untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => stripComments(readFileSync(path.join(root, file), "utf8"));

type Block = { prelude: string; body: string };

/** The blocks at one nesting level of `source`: a prelude (selector or at-rule) and the text between its braces. */
function blocks(source: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = source.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        found.push({ prelude, body: source.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return found;
}

/** The declarations of the rules whose selector list contains `selector` exactly, outside any at-rule. */
function rule(source: string, selector: string): string {
  return blocks(source)
    .filter((block) => !block.prelude.startsWith("@") && block.prelude.split(",").map((part) => part.trim()).includes(selector))
    .map((block) => block.body)
    .join("\n");
}

/** Every block of the at-rule `prelude`, joined (a file may open the same media query more than once). */
const media = (source: string, prelude: string) =>
  blocks(source)
    .filter((block) => block.prelude === prelude)
    .map((block) => block.body)
    .join("\n");
const TOUCH = "@media (pointer: coarse), (max-width: 480px)";

describe("board.css", () => {
  const css = read("src/components/styles/board.css");

  it("never makes a whole card a touch grip: no touch-action on the card or in the file", () => {
    expect(css).not.toMatch(/touch-action/);
  });

  it("snaps column to column on a phone, mandatory so a swipe never rests between two", () => {
    expect(media(css, "@media (max-width: 480px)")).toMatch(/scroll-snap-type:\s*x mandatory/);
    expect(css).not.toMatch(/x proximity/);
  });

  it("shows the card grip only under a coarse pointer or on a phone", () => {
    expect(rule(css, ".tessera-board-card-grip")).toMatch(/display:\s*none/);
    expect(media(css, TOUCH)).toMatch(/\.tessera-board-card-grip\s*\{[^}]*display:\s*block/);
  });

  it("rests the card on --shadow-low, lifts it to --shadow-med on hover and marks the peeked one with the accent", () => {
    expect(rule(css, ".tessera-board-card")).toMatch(/box-shadow:\s*var\(--shadow-low\)/);
    expect(rule(css, ".tessera-board-card:hover")).toMatch(/box-shadow:\s*var\(--shadow-med\)/);
    expect(rule(css, '.tessera-board-card[aria-current="true"]')).toMatch(/border-color:\s*var\(--color-accent\)/);
  });

  it("dims the card menu until hover or focus, keeps it on where there is no hover, and never turns off pointer events", () => {
    expect(rule(css, ".tessera-board-card-menu")).toMatch(/opacity:\s*0/);
    const shown = blocks(css).find((block) => block.prelude.includes(".tessera-board-card:hover .tessera-board-card-menu"));
    expect(shown?.prelude).toContain(".tessera-board-card:focus-within .tessera-board-card-menu");
    expect(shown?.body).toMatch(/opacity:\s*1/);
    expect(media(css, "@media (hover: none)")).toMatch(/\.tessera-board-card-menu\s*\{[^}]*opacity:\s*1/);
    expect(rule(css, ".tessera-board-card-menu")).not.toMatch(/pointer-events/);
  });

  it("sticks the swimlane heads to the top and each lane bar below them and to the start edge", () => {
    expect(rule(css, ".tessera-board-heads")).toMatch(/position:\s*sticky/);
    expect(rule(css, ".tessera-board-heads")).toMatch(/inset-block-start:\s*0/);
    expect(rule(css, ".tessera-board-heads")).toMatch(/background-color:\s*var\(--color-background-surface\)/);
    const bar = rule(css, ".tessera-board-lane > .astryx-collapsible-trigger");
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/inset-block-start:\s*var\(--tessera-board-head-h/);
    expect(bar).toMatch(/inset-inline-start:\s*0/);
  });

  it("gives the column head a 44px minimum and a 44px lane bar only for a finger", () => {
    expect(css).toMatch(/\.tessera-board-column \.astryx-layout-header\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    expect(media(css, TOUCH)).toMatch(/\.tessera-board-lane > \.astryx-collapsible-trigger\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    expect(rule(css, ".tessera-board-lane > .astryx-collapsible-trigger")).not.toMatch(/min-block-size/);
  });

  it("makes a column head exactly 44px (8 + 28 + 7 + the 1px divider) on a desktop and under a finger alike (the add button keeps 28px)", () => {
    // The head sits inside the Layout wrapper, so the selector is a descendant one, not a child of the column card.
    expect(rule(css, ".tessera-board-column .astryx-layout-header > :first-child")).toMatch(
      /padding-block:\s*var\(--spacing-2\) calc\(var\(--spacing-2\) - var\(--border-width\)\)/,
    );
    expect(media(css, TOUCH)).not.toMatch(/\.tessera-board-column \.astryx-layout-header/);
  });

  it("keeps the card menu slot and button at the desktop size under a finger (the hit area is the theme's), so the drag overlay is as tall as the card", () => {
    expect(rule(css, ".tessera-board-card-menu")).toMatch(/min-block-size:\s*var\(--size-element-sm\)/);
    expect(media(css, TOUCH)).not.toMatch(/\.tessera-board-card-menu\s*\{[^}]*min-block-size/);
  });
});

/**
 * The quick-add placeholder row and card fade in on Astryx's `fadeIn` entry animation, which drives `opacity` from 0 to 1
 * and holds the first frame (`fill: backwards`). A rule that rests at `opacity: 0.6` would therefore climb to 1 and drop
 * to 0.6 when the animation ends: a visible pop. They are dimmed with `filter: opacity(0.6)`, a property the animation
 * does not touch, so the fade and the dimming compose.
 */
describe("quick-add placeholders", () => {
  const files = ["src/components/styles/work-items.css", "src/components/styles/board.css"];
  const dimmed = [
    { file: files[0]!, selector: ".tessera-wi-row-pending" },
    { file: files[1]!, selector: ".tessera-board-card-pending" },
  ];

  it("dims the row and the card with filter: opacity(0.6)", () => {
    for (const { file, selector } of dimmed) {
      expect(rule(read(file), selector), `${selector} in ${file}`).toMatch(/filter:\s*opacity\(0\.6\)/);
    }
  });

  it("sets no opacity on a pending rule anywhere, in a media query or not (the pop would come back)", () => {
    for (const file of files) {
      const css = read(file);
      for (const match of css.matchAll(/([^{}]*-pending[^{}]*)\{([^{}]*)\}/g)) {
        expect(match[2], `${match[1]!.trim()} in ${file}`).not.toMatch(/(^|[;\s])opacity\s*:/);
      }
    }
  });

  it("finds both rules in the first place (the scan above would otherwise pass on nothing)", () => {
    for (const { file, selector } of dimmed) expect(read(file)).toContain(`${selector} {`);
  });
});

describe("table.css", () => {
  const css = read("src/components/styles/table.css");

  it("lets the work items scroller scroll the table so the header sticks (the Astryx wrapper no longer clips)", () => {
    expect(rule(css, ".astryx-table-scroll-wrapper:has(.tessera-table)")).toMatch(/overflow:\s*visible/);
    const header = rule(css, ".tessera-table .astryx-table-header-cell");
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/inset-block-start:\s*0/);
    expect(header).toMatch(/background-color:\s*var\(--color-background-surface\)/);
  });

  it("lets the selection checkbox's 44px native input through the cell's clip on touch", () => {
    expect(media(css, TOUCH)).toMatch(/\.tessera-table \.astryx-table-cell\.tessera-table-select-cell,\s*\.tessera-table \.astryx-table-header-cell\[data-column-key="__xds_selection"\]\s*\{\s*overflow:\s*visible;/);
  });

  it("starts the selection checkbox on the 16px inset and the group header on the inset with a sticky label", () => {
    expect(rule(css, ".tessera-table .astryx-table-cell.tessera-table-select-cell")).toMatch(/padding-inline-end:\s*0/);
    expect(rule(css, ".tessera-table .astryx-table-row > td[colspan]")).toMatch(/padding-inline-start:\s*var\(--spacing-4\)/);
    const label = rule(css, ".tessera-table .astryx-table-row > td[colspan] > :first-child");
    expect(label).toMatch(/position:\s*sticky/);
    expect(label).toMatch(/inline-size:\s*max-content/);
  });

  it("pads the nine property headers to their ghost control's text and keeps the sort button off the resize handle", () => {
    const headers = blocks(css).find((block) => block.prelude.includes('[data-column-key="state"]') && block.prelude.includes('[data-column-key="estimate"]'));
    expect(headers?.body).toMatch(/padding-inline-start:\s*var\(--spacing-5\)/);
    expect(rule(css, ".tessera-table .astryx-table-header-cell > div:has(> button)")).toMatch(/padding-inline-end:\s*var\(--spacing-2\)/);
    expect(rule(css, ".tessera-table .astryx-table-header-cell button > span:has(> .astryx-icon)")).toMatch(/opacity:\s*1/);
  });

  it("marks the peeked row with an accent edge on its first cell", () => {
    expect(rule(css, '.tessera-table-row[aria-current="true"] > :first-child')).toMatch(/box-shadow:\s*inset[^;]*var\(--color-accent\)/);
  });

  it("applies the 44px row, header, selector and chevron rules only under a coarse pointer or on a phone", () => {
    const touch = media(css, TOUCH);
    expect(touch).toMatch(/\.astryx-table-cell,[\s\S]*\.astryx-table-header-cell\s*\{[^}]*height:\s*var\(--spacing-11\)/);
    expect(touch).toMatch(/\[data-resize-handle\]\s*\{[^}]*display:\s*none/);
    expect(touch).toMatch(/\.astryx-multi-selector > button/);
    expect(touch).toMatch(/button\[aria-expanded\]\s*\{[^}]*min-inline-size:\s*var\(--spacing-11\)/);
    const outside = css.replace(touch, "");
    expect(outside).not.toMatch(/--spacing-11/);
  });
});
