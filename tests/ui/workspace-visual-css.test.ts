/**
 * Visual-audit fixes of the workspace screens (W1 to W13), read from the
 * stylesheets because jsdom runs no layout: the inbox pane switch below 1024px,
 * the sticky board (content height, 540px cap, readable text on tints), the
 * quick link card row (menu quiet until hover or focus), Home recents on the
 * heading's x, the analytics phone header, and the touch targets (decision 14)
 * that exist only under "(pointer: coarse), (max-width: 480px)".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function css(file: string): string {
  return readFileSync(path.join(process.cwd(), "src/components/styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const escape = (selector: string) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (text: string) => text.replace(/\s+/g, " ");

/** The declarations of the first rule whose selector list is exactly `selector`, at any nesting. */
function rule(source: string, selector: string): string {
  const match = new RegExp(`(?:^|[}{])\\s*${escape(squash(selector))}\\s*\\{([^}]*)\\}`).exec(squash(source));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

/** The text of every `@media <query>` block (braces balanced), joined. */
function media(source: string, query: string): string {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(`@media ${query}`, from);
    if (start < 0) break;
    const open = source.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error(`unbalanced @media ${query}`);
    found.push(source.slice(open + 1, end));
    from = end;
  }
  if (found.length === 0) throw new Error(`no @media ${query}`);
  return found.join("\n");
}

describe("inbox below 1024px (W1)", () => {
  const inbox = css("inbox.css");
  const narrow = media(inbox, "(max-width: 1023px)");

  it("fills the panel with the list and drops the resize handle", () => {
    expect(rule(narrow, ".tessera-inbox .tessera-inbox-list")).toMatch(/inline-size:\s*100%/);
    expect(rule(narrow, ".tessera-inbox .tessera-inbox-list")).toMatch(/max-inline-size:\s*100%/);
    expect(rule(narrow, ".tessera-inbox .astryx-resize-handle")).toMatch(/display:\s*none/);
  });

  it("shows the list or the detail, never both, and the Back button only for the detail", () => {
    expect(rule(narrow, ".tessera-inbox:not(.tessera-inbox--item) .tessera-inbox-detail")).toMatch(/display:\s*none/);
    expect(rule(narrow, ".tessera-inbox--item .tessera-inbox-list")).toMatch(/display:\s*none/);
    expect(rule(narrow, ".tessera-inbox .tessera-inbox-back")).toMatch(/display:\s*flex/);
    expect(rule(inbox, ".tessera-inbox .tessera-inbox-back")).toMatch(/display:\s*none/);
  });
});

describe("inbox rows (W4, W9, W11)", () => {
  const inbox = css("inbox.css");

  it("starts rows on the 16px header inset and reserves the unread dot's slot", () => {
    expect(rule(inbox, ".tessera-inbox-list li.astryx-item")).toMatch(/padding-inline:\s*var\(--spacing-4\)/);
    expect(rule(inbox, ".tessera-inbox-dot")).toMatch(/inline-size:\s*var\(--spacing-2\)/);
  });

  it("gives the avatar initials the primary text colour, without the row tint on the selected row", () => {
    expect(rule(inbox, ".tessera-inbox-list .astryx-avatar-fallback")).toMatch(/color:\s*var\(--color-text-primary\)/);
    expect(rule(inbox, '.tessera-inbox-list [aria-current="true"] .astryx-avatar-fallback')).toMatch(/background-color:\s*transparent/);
  });

  it("lifts the row's main button and a short tab to 44px on touch", () => {
    const touch = media(inbox, "(pointer: coarse), (max-width: 480px)");
    expect(rule(touch, ".tessera-inbox-list li.astryx-item button:not(.astryx-button)")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(rule(touch, ".tessera-inbox-tabs .astryx-tab")).toMatch(/min-inline-size:\s*var\(--spacing-11\)/);
  });
});

describe("stickies board (W5, W11, W6)", () => {
  const stickies = css("stickies.css");

  it("sizes a card to its own content and caps it at 540px, the note scrolling inside", () => {
    expect(rule(stickies, ".tessera-stickies-board")).toMatch(/align-items:\s*start/);
    expect(rule(stickies, ".tessera-stickies-board .tessera-sticky")).toMatch(/max-block-size:\s*calc\(var\(--spacing-12\) \* 11 \+ var\(--spacing-3\)\)/);
    expect(rule(stickies, ".tessera-sticky-content > .tessera-sticky-body")).toMatch(/overflow-y:\s*auto/);
  });

  it("does not use display on the card, so the dragged card still hides", () => {
    expect(rule(stickies, ".tessera-sticky--dragging")).toMatch(/display:\s*none/);
    expect(rule(stickies, ".tessera-stickies-board .tessera-sticky")).not.toMatch(/display/);
  });

  it("sets the text on a tint to the primary colour", () => {
    expect(rule(stickies, ".tessera-sticky .astryx-text,\n.tessera-sticky .astryx-field-label")).toMatch(/color:\s*var\(--color-text-primary\)/);
  });

  it("makes the in-card name field and colour select 44px on touch, and leaves the search field to the theme's hit area", () => {
    const touch = media(stickies, "(pointer: coarse), (max-width: 480px)");
    expect(touch).toMatch(/\.tessera-sticky-content \.astryx-text-input,[\s\S]*min-block-size:\s*var\(--spacing-11\)/);
    expect(touch).toMatch(/\.tessera-sticky-content \.astryx-selector button\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    expect(touch).not.toMatch(/search/);
  });
});

describe("home (W7, W8, W13, W6)", () => {
  const home = css("home.css");

  it("is a 56px card row with a 32px icon tile and an 8px gap kept by the wrap", () => {
    expect(rule(home, ".tessera-quick-link")).toMatch(/min-block-size:\s*calc\(var\(--spacing-12\) \+ var\(--spacing-2\)\)/);
    expect(rule(home, ".tessera-quick-link-tile")).toMatch(/inline-size:\s*var\(--spacing-8\)/);
    expect(rule(home, ".tessera-quick-link-tile")).toMatch(/block-size:\s*var\(--spacing-8\)/);
  });

  it("keeps the card menu quiet until hover or focus, and visible on a touch screen", () => {
    expect(rule(home, ".tessera-quick-link-menu")).toMatch(/opacity:\s*0/);
    expect(home).toMatch(/\.tessera-quick-link:hover \.tessera-quick-link-menu,\s*\.tessera-quick-link:focus-within \.tessera-quick-link-menu,\s*\.tessera-quick-link-menu:has\(\[aria-expanded="true"\]\)\s*\{\s*opacity:\s*1/);
    expect(rule(media(home, "(hover: none), (pointer: coarse)"), ".tessera-quick-link-menu")).toMatch(/opacity:\s*1/);
  });

  it("pulls the recents list out by its own 8px inset", () => {
    expect(rule(home, ".tessera-recents > .astryx-list")).toMatch(/margin-inline:\s*calc\(-1 \* var\(--spacing-2\)\)/);
  });

  it("makes the since rows, the recents rows, Open Your work and the quick link title 44px on touch", () => {
    const touch = media(home, "(pointer: coarse), (max-width: 480px)");
    const anchors = rule(touch, ".tessera-home-since li.astryx-item a,\n  .tessera-recents li.astryx-item a");
    expect(anchors).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    // The anchors are column flex boxes: centring on the block axis is justify-content; align-items: center clipped the nowrap title.
    expect(anchors).toMatch(/justify-content:\s*center/);
    expect(anchors).not.toMatch(/align-items/);
    expect(rule(touch, ".tessera-home-open")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(rule(touch, ".tessera-quick-link-title")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(rule(touch, ".tessera-quick-link-title")).toMatch(/position:\s*relative/);
    // The recents row has no block padding of its own, so a row is 44px, not 44 plus padding.
    expect(rule(touch, ".tessera-recents li.astryx-item")).toMatch(/padding-block:\s*0/);
  });
});

describe("analytics (W2, W6, W12)", () => {
  const analytics = css("analytics.css");

  it("stacks the phone header: title, filters, then the tabs on their own row", () => {
    const phone = media(analytics, "(max-width: 599px)");
    const grid = rule(phone, ".tessera-panel-bar.tessera-panel-bar--tabs-below.tessera-analytics-header");
    expect(grid).toMatch(/grid-template-areas:\s*"title"\s*"end"\s*"tabs"/);
  });

  it("does not reuse the name of the completion bar for the header", () => {
    expect(analytics).not.toMatch(/\.tessera-analytics-bar\s*>\s*\.tessera-panel-bar/);
  });

  it("gives the Data table trigger a hover overlay", () => {
    expect(analytics).toMatch(/\.tessera-analytics-data-table \.astryx-collapsible-trigger:hover[^{]*\{[^}]*background-image:\s*linear-gradient\(var\(--color-overlay-hover\)/);
  });

  it("makes the trigger, the pickers and the table links 44px on touch, with no negative margins that would overlap rows", () => {
    const touch = media(analytics, "(pointer: coarse), (max-width: 480px)");
    expect(rule(touch, ".tessera-analytics-data-table .astryx-collapsible-trigger")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(rule(touch, ".tessera-analytics-link")).toMatch(/min-inline-size:\s*var\(--spacing-11\)/);
    expect(touch).not.toMatch(/margin-block/);
  });
});

describe("analytics table column floors (W3)", () => {
  it("keeps a count column wide enough for the 'Completed' header and the chart tables use the shared floors", async () => {
    const { COUNT_COLUMN } = await import("@/components/analytics/table-widths");
    expect(JSON.stringify(COUNT_COLUMN)).toMatch(/"minWidth":100\b/);
    const source = readFileSync(path.join(process.cwd(), "src/components/charts/SeriesCharts.tsx"), "utf8");
    expect(source).toContain("NAME_COLUMN");
    expect(source).toContain("COUNT_COLUMN");
    expect(source).toContain("TEXT_COLUMN");
  });
});
