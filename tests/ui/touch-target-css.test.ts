/**
 * Touch targets and the header tab-strip rules (S1, S7; decision 14), read from
 * the stylesheets because jsdom runs no CSS layout. Under "(pointer: coarse),
 * (max-width: 480px)" a control keeps its drawn size and gets a 44px HIT area,
 * an absolutely positioned `::before` centred on it (theme adaptations plus
 * shell.css); only menu, option, palette and drawer rows are 44px boxes. No
 * desktop rule changed (the 1440 geometry: top bar 48px, rows 32px, header
 * controls 28px), and the generic tab-strip rules in shell.css hold the dock,
 * the inset and the two-row phone grid.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

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

const TOUCH_MEDIA = "@media (pointer: coarse), (max-width: 480px)";
const touchOnly = /min-(block|inline)-size:\s*var\(--spacing-11\)|\.tessera-hit|--tessera-hit-base|input\[role="switch"\]|input\[type="checkbox"\]|::before|max-height:\s*min\(/;

describe("theme touch targets (catppuccin.css, built from catppuccinTheme.ts)", () => {
  const built = stripComments(read("src/themes/catppuccin/catppuccin.css"));
  // The adaptations sit in a layer block: @layer astryx-theme { @media (...) { @scope (...) { ... } } }
  const layerBlocks = blocks(built).filter((block) => block.prelude.startsWith("@layer"));
  const medias = layerBlocks.flatMap((layer) => blocks(layer.body)).filter((block) => block.prelude.startsWith("@media"));
  const coarse = medias.find((block) => block.prelude === "@media (pointer: coarse)");
  const narrow = medias.find((block) => block.prelude === "@media (width < 481px)");

  const HIT = "inset-block:\\s*min\\(0px, calc\\(\\(100% - var\\(--spacing-11\\)\\) / 2\\)\\)";
  const hitRule = (selector: string, inline: string) =>
    new RegExp(`${selector.replace(/\./g, "\\.")}::before\\s*\\{[^}]*content:\\s*"";[^}]*position:\\s*absolute;[^}]*${HIT};[^}]*inset-inline:\\s*${inline};`);
  const BOTH = "min\\(0px, calc\\(\\(100% - var\\(--spacing-11\\)\\) / 2\\)\\)";

  it("gives Astryx controls a 44px hit area (a ::before centred on the control), under a coarse pointer and at 480px and narrower", () => {
    expect(coarse, "(pointer: coarse) block").toBeDefined();
    expect(narrow, "(width < 481px) block, the same as max-width: 480px").toBeDefined();
    for (const block of [coarse, narrow]) {
      for (const selector of [".astryx-button", ".astryx-tab", ".astryx-top-nav-heading", ".astryx-text-input", ".astryx-tokenizer", ".astryx-number-input", ".astryx-date-input", ".astryx-time-input", ".astryx-toggle-button", ".astryx-input-clear-button"]) {
        expect(block?.body, selector).toMatch(hitRule(selector, BOTH));
      }
    }
  });

  it("limits an overlay arrow and a segment to the block axis, so neither covers the control beside it", () => {
    for (const block of [coarse, narrow]) {
      for (const selector of [".astryx-tab-scroll-button", ".astryx-segmented-control-item", ".astryx-side-nav-heading"]) {
        expect(block?.body, selector).toMatch(hitRule(selector, "0"));
      }
    }
  });

  it("keeps the drawn size: no control that carries a hit area gets a minimum size", () => {
    for (const block of [coarse, narrow]) {
      for (const selector of [".astryx-button", ".astryx-tab", ".astryx-tab-scroll-button", ".astryx-segmented-control-item", ".astryx-top-nav-heading", ".astryx-side-nav-heading", ".astryx-text-input", ".astryx-selector"]) {
        expect(block?.body, selector).not.toMatch(new RegExp(`${selector.replace(/\./g, "\\.")}\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*min-(block|inline)-size`));
      }
    }
  });

  it("makes menu, option, palette and drawer rows 44px boxes (lists with room by design)", () => {
    for (const block of [coarse, narrow]) {
      for (const selector of [".astryx-dropdown-menu-item", ".astryx-selector-option-row", ".astryx-command-palette-item", ".astryx-side-nav-item"]) {
        expect(block?.body, selector).toMatch(new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{[^}]*min-block-size:\\s*var\\(--spacing-11\\)`));
      }
    }
  });

  it("applies the same rules in both queries (an OR of the two conditions)", () => {
    expect(narrow?.body).toBe(coarse?.body);
  });

  it("changes no desktop rule: outside the two media blocks no minimum size is set", () => {
    let outside = built;
    for (const block of [coarse, narrow]) {
      if (block) outside = outside.replace(block.body, "");
    }
    expect(outside).not.toMatch(/min-(block|inline)-size/);
    expect(outside).not.toMatch(/::before/);
  });

  it("moves only the `sm` width point, to 481, and keeps the AppShell drawer breakpoint (md, 768)", () => {
    const js = read("src/themes/catppuccin/catppuccin.js");
    expect(js).toMatch(/"sm":\s*481/);
    expect(js).toMatch(/"md":\s*768/);
    expect(read("src/components/shell/TesseraShell.tsx")).not.toMatch(/breakpoint=/);
  });

  it("draws a list row's focus ring inside the row (S6), not only on a coarse pointer", () => {
    expect(built).toMatch(/\.astryx-list-item\s*\{[^}]*outline-offset:\s*calc\(-1 \* var\(--focus-outline-width\)\)/);
  });
});

describe("shell.css touch rules", () => {
  const shell = stripComments(read("src/components/styles/shell.css"));
  const top = blocks(shell);
  const touch = top.find((block) => block.prelude === TOUCH_MEDIA);

  it("puts the switch, checkbox and dense-row hit areas under the touch media query only", () => {
    expect(touch, TOUCH_MEDIA).toBeDefined();
    expect(touch?.body).toMatch(/\.astryx-switch-field input\[role="switch"\]/);
    expect(touch?.body).toMatch(/\.astryx-checkbox-input input\[type="checkbox"\]/);
    expect(touch?.body).toMatch(/\.tessera-hit\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)[^}]*margin-block:\s*calc\(\(var\(--tessera-hit-base\) - var\(--spacing-11\)\) \/ 2\)/);
    expect(touch?.body).toMatch(/\.tessera-hit-x\s*\{[^}]*min-inline-size:\s*var\(--spacing-11\)[^}]*margin-inline:\s*calc\(\(var\(--tessera-hit-base\) - var\(--spacing-11\)\) \/ 2\)/);
  });

  const hit = "inset-block:\\s*min\\(0px, calc\\(\\(100% - var\\(--spacing-11\\)\\) / 2\\)\\);\\s*inset-inline:\\s*min\\(0px, calc\\(\\(100% - var\\(--spacing-11\\)\\) / 2\\)\\)";

  it("gives a Selector's and a MultiSelector's trigger button a 44px hit area that adds no height", () => {
    expect(touch?.body).toMatch(/\.astryx-selector \[role="combobox"\],\s*\.astryx-multi-selector \[role="combobox"\],\s*button\[role="combobox"\],\s*\.astryx-complex-selector > button\s*\{[^}]*position:\s*relative/);
    expect(touch?.body).toMatch(new RegExp(`\\.astryx-selector \\[role="combobox"\\]::before,\\s*\\.astryx-multi-selector \\[role="combobox"\\]::before,\\s*button\\[role="combobox"\\]::before,\\s*\\.astryx-complex-selector > button::before\\s*\\{[^}]*content:\\s*"";[^}]*position:\\s*absolute;[^}]*${hit}`));
    expect(touch?.body).not.toMatch(/\.astryx-(text-input|selector)[^{]*\{[^}]*margin-block/);
  });

  it("gives a DateInput's calendar toggle an area that reaches the field's edge and stops 8px short of the text", () => {
    expect(touch?.body).toMatch(/\.astryx-date-input > button\[aria-label="Open calendar"\]\s*\{\s*position:\s*relative/);
    expect(touch?.body).toMatch(/\.astryx-date-input > button\[aria-label="Open calendar"\]::before\s*\{[^}]*inset-inline:\s*calc\(-1 \* var\(--spacing-5\)\) calc\(-1 \* var\(--spacing-2\)\)/);
  });

  it("gives a filter token's buttons a hit area, the remove cross outward only", () => {
    expect(touch?.body).toMatch(new RegExp(`\\.astryx-token > button::before\\s*\\{[^}]*content:\\s*"";[^}]*${hit}`));
    expect(touch?.body).toMatch(/\.astryx-token > button:last-of-type:not\(:only-of-type\)::before\s*\{[^}]*inset-inline-start:\s*0/);
  });

  it("lets a token's hit area through Astryx's clip (overflow: clip with a 16px margin) and spaces wrapped token lines 8px", () => {
    expect(touch?.body).toMatch(/\.astryx-token,\s*\.astryx-token > button\s*\{[^}]*overflow:\s*clip !important;[^}]*overflow-clip-margin:\s*var\(--spacing-4\) !important/);
    expect(touch?.body).toMatch(/\.astryx-tokenizer\s*\{[^}]*row-gap:\s*var\(--spacing-2\) !important/);
  });

  it("pads a scrolling tab strip 8px above and below and takes it back, so the tabs' hit area is not clipped", () => {
    expect(touch?.body).toMatch(/\.astryx-tab-strip\s*\{\s*padding-block:\s*var\(--spacing-2\);\s*margin-block:\s*calc\(-1 \* var\(--spacing-2\)\)/);
  });

  it("lifts the 300px menu cap so 44px rows still fit (the project menu's Move up and Move down)", () => {
    expect(touch?.body).toMatch(/\.astryx-dropdown-menu,\s*div:has\(> \.astryx-popover > \.astryx-dropdown-menu\)\s*\{[^}]*max-height:\s*min\(calc\(var\(--spacing-12\) \* 10\), 70dvh\)[^}]*max-block-size:\s*min\(calc\(var\(--spacing-12\) \* 10\), 70dvh\)/);
  });

  it("offers `tessera-hit--y` (block axis only) and `tessera-hit--none` for a control the generic area would overlap", () => {
    expect(touch?.body).toMatch(/\.tessera-hit--y::before\s*\{[^}]*inset-inline:\s*0/);
    expect(touch?.body).toMatch(/\.tessera-hit--none::before\s*\{[^}]*content:\s*none/);
  });

  it("reaches a SegmentedControl's outermost segments 8px past the group's edge, the segments between tile exactly", () => {
    expect(touch?.body).toMatch(/\.astryx-segmented-control-item:first-of-type::before\s*\{[^}]*inset-inline-start:\s*min\(0px/);
    expect(touch?.body).toMatch(/\.astryx-segmented-control-item:last-of-type::before\s*\{[^}]*inset-inline-end:\s*min\(0px/);
  });

  it("no longer grows a field box or a bare input (the hit area replaced the 44px box)", () => {
    expect(touch?.body).not.toMatch(/\.astryx-text-input input/);
    expect(touch?.body).not.toMatch(/tessera-topbar-search/);
  });

  it("has no touch-only rule outside that query", () => {
    for (const block of top) {
      if (block.prelude === TOUCH_MEDIA) continue;
      expect(`${block.prelude} {${block.body}}`, block.prelude).not.toMatch(touchOnly);
    }
  });
});

describe("header tab strips (S7, shell.css)", () => {
  const shell = stripComments(read("src/components/styles/shell.css"));

  it("docks any TabList in a bar's start group on the hairline", () => {
    expect(shell).toMatch(/\.tessera-panel-bar-start:has\(> \.astryx-tab-list\)\s*\{[^}]*align-self:\s*stretch/);
    expect(shell).toMatch(/\.tessera-panel-bar \.astryx-tab-list\s*\{[^}]*align-self:\s*flex-end[^}]*min-width:\s*0/);
  });

  it("pulls a leading strip onto the 16px inset", () => {
    expect(shell).toMatch(/\.tessera-panel-bar-start > \.astryx-tab-list:first-child\s*\{[^}]*margin-inline-start:\s*calc\(-1 \* var\(--spacing-3\)\)/);
  });

  it("makes tabsBelow the two-row grid below 600px with a 44px first row and 44px tabs", () => {
    const narrow = blocks(shell).find((block) => block.prelude === "@media (max-width: 599px)" && block.body.includes("tabs-below"));
    expect(narrow).toBeDefined();
    expect(narrow?.body).toMatch(/"title end"\s+"tabs tabs"/);
    expect(narrow?.body).toMatch(/grid-template-rows:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-3\)\) auto/);
    expect(narrow?.body).toMatch(/\.tessera-panel-bar--tabs-below > \.tessera-panel-bar-start\s*\{[^}]*display:\s*contents/);
    expect(narrow?.body).toMatch(/\.tessera-panel-bar--tabs-below \.astryx-tab\s*\{[^}]*min-height:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-3\)\)/);
    expect(narrow?.body).toMatch(/:not\(\.astryx-tab-list\)\s*\{[^}]*grid-area:\s*title[^}]*flex-shrink:\s*0/);
  });

  it("lets the tabs-below strip run to the bar's inner edge: Astryx caps a TabList at 100%, so max-width is lifted", () => {
    expect(shell).toMatch(/\.tessera-panel-bar--tabs-below > \.tessera-panel-bar-start > \.astryx-tab-list\s*\{[^}]*width:\s*calc\(100% \+ var\(--spacing-3\)\);[^}]*max-width:\s*none/);
    expect(shell).toMatch(/\.tessera-project-bar \.tessera-project-tabs\s*\{[^}]*width:\s*calc\(100% \+ var\(--spacing-3\)\);[^}]*max-width:\s*none/);
  });

  it("applies the tabs-below grid outside a media query to nothing", () => {
    const outside = blocks(shell).filter((block) => !block.prelude.startsWith("@media"));
    for (const block of outside) expect(block.body).not.toContain("grid-template-areas");
  });

  it("gives a bar with a title in front of its strip the same two rows from 600 to 1099px (the docked sidebar), and leaves a bar with no title alone", () => {
    const tablet = blocks(shell).find((block) => block.prelude === "@media (min-width: 600px) and (max-width: 1099px)");
    expect(tablet).toBeDefined();
    const titled = ":has(> .tessera-panel-bar-start > :not(.astryx-tab-list))";
    expect(tablet?.body).toContain(`.tessera-panel-bar.tessera-panel-bar--tabs-below${titled} {`);
    expect(tablet?.body).toMatch(/"title end"\s+"tabs tabs"/);
    expect(tablet?.body).toMatch(/grid-template-rows:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-3\)\) auto/);
    expect(tablet?.body).toMatch(/\.tessera-panel-bar--tabs-below:has\([^)]*\)\)? > \.tessera-panel-bar-start\s*\{[^}]*display:\s*contents/);
    // Every rule that changes the layout carries the :has() guard, so the Pages sub-header (no title) keeps its own row.
    for (const rule of blocks(tablet?.body ?? "")) {
      if (rule.body.includes("display: contents") || rule.body.includes("grid-template")) expect(rule.prelude, rule.prelude).toContain(titled);
    }
    // The tabs keep their desktop height: the 44px tab is the phone rule only.
    expect(tablet?.body).not.toContain("min-height: calc(var(--size-element-md)");
  });

  it("gives the Pages sub-header (no title) the two-row layout from 600 to 1099px too, in pages.css: the docked sidebar left its strip half hidden at 768px", () => {
    const pages = stripComments(read("src/components/styles/pages.css"));
    const wide = blocks(pages).find((block) => block.prelude === "@media (max-width: 1099px)");
    expect(wide?.body).toMatch(/\.tessera-panel-bar\.tessera-panel-bar--tabs-below\.tessera-pages-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*"end"\s+"tabs"/);
    const tablet = blocks(pages).find((block) => block.prelude === "@media (min-width: 600px) and (max-width: 1099px)");
    expect(tablet?.body).toMatch(/\.tessera-pages-bar\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*calc\(var\(--size-element-md\) \+ var\(--spacing-3\)\) auto/);
    expect(tablet?.body).toMatch(/\.tessera-pages-bar > \.tessera-panel-bar-start\s*\{[^}]*display:\s*contents/);
    expect(tablet?.body).toMatch(/\.astryx-tab-list\s*\{[^}]*grid-area:\s*tabs[^}]*max-width:\s*none/);
    // The tabs keep their desktop height from 600px; the 44px tab is the phone rule.
    expect(tablet?.body).not.toContain("min-height: calc(var(--size-element-md)");
  });

  it("makes a strip alone in a sub-header (archives, settings) a row of 44px tabs under a touch query", () => {
    const touch = blocks(shell).find((block) => block.prelude === TOUCH_MEDIA);
    expect(touch?.body).toMatch(/\.tessera-panel-bar--subheader > \.tessera-panel-bar-start > \.astryx-tab-list \.astryx-tab\s*\{[^}]*min-height:\s*var\(--spacing-11\)/);
  });

  it("keeps the archives and inbox strips on these generic rules: no copy of their own", () => {
    const archives = stripComments(read("src/components/styles/archives.css"));
    const inbox = stripComments(read("src/components/styles/inbox.css"));
    expect(archives).not.toContain("tessera-archives-tabs");
    expect(inbox).not.toMatch(/tessera-inbox-(bar|title)/);
    expect(inbox).not.toContain("grid-template");
    expect(read("src/components/planning/ArchivesTabs.tsx")).not.toContain("tessera-archives-tabs");
    expect(read("src/components/inbox/InboxScreen.tsx")).toMatch(/<PanelBar\s+tabsBelow\s+start=/);
  });

  it("starts the inbox's 44px-wide All tab label at the tab's padding, so the first label sits on the 16px inset (not centred 2px right)", () => {
    const inbox = stripComments(read("src/components/styles/inbox.css"));
    const touch = blocks(inbox).find((block) => block.prelude === TOUCH_MEDIA);
    const rule = blocks(touch?.body ?? "").find((block) => block.prelude === ".tessera-inbox-tabs .astryx-tab");
    expect(rule?.body).toMatch(/min-inline-size:\s*var\(--spacing-11\)/);
    expect(rule?.body).toMatch(/justify-content:\s*flex-start/);
    expect(rule?.body).not.toMatch(/justify-content:\s*center/);
  });

  it("keeps the intake filters row's 44px button areas 2px clear of the first row, whose area starts where the bar ends", () => {
    const intake = stripComments(read("src/components/styles/intake.css"));
    const touch = blocks(intake).find((block) => block.prelude === TOUCH_MEDIA);
    const rule = blocks(touch?.body ?? "").find((block) => block.prelude === ".tessera-intake-filters.tessera-panel-bar--wraps");
    expect(rule?.body).toMatch(/padding-block:\s*var\(--spacing-2\)/);
    expect(rule?.body).toMatch(/padding-block-end:\s*calc\(var\(--spacing-2\) \+ var\(--spacing-0-5\)\)/);
  });
});

describe("product base layer (S5, base.css)", () => {
  const base = stripComments(read("src/components/styles/base.css"));

  it("is the first import of globals.css, so its layer statement comes first", () => {
    const imports = [...read("src/app/globals.css").matchAll(/@import "([^"]+)";/g)].map((match) => match[1]);
    expect(imports[0]).toBe("../components/styles/base.css");
  });

  it("orders the fallback layer under the Astryx layers", () => {
    expect(base).toMatch(/@layer tessera-fallback, reset, astryx-base, astryx-theme;/);
  });

  it("gives non-Astryx focusables the accent ring at zero specificity, and native controls the accent colour", () => {
    expect(base).toMatch(/accent-color:\s*var\(--color-accent\)/);
    expect(base).toMatch(/:where\(a\[href\][\s\S]*?time\[tabindex\][\s\S]*?\[role="button"\][\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*var\(--focus-outline-width\) var\(--focus-outline-style\) var\(--focus-outline-color\)[^}]*outline-offset:\s*var\(--focus-outline-offset\)/);
  });
});

describe("top bar icon buttons keep apart under the touch query (shell.css, TopBar.tsx)", () => {
  const shell = stripComments(read("src/components/styles/shell.css"));
  const touch = blocks(shell).find((block) => block.prelude === TOUCH_MEDIA);

  it("spaces the end group 16px apart (28px drawn buttons get a 44px pitch) and 12px from the window edge", () => {
    expect(touch?.body).toMatch(/\.astryx-top-nav \.tessera-topbar-end\s*\{[^}]*column-gap:\s*var\(--spacing-4\);[^}]*margin-inline-end:\s*var\(--spacing-3\)/);
  });

  it("spaces the heading group (collapse button, brand) 8px apart", () => {
    expect(touch?.body).toMatch(/\.astryx-top-nav \.tessera-topbar-heading\s*\{[^}]*column-gap:\s*var\(--spacing-2\)/);
  });

  it("TopBar.tsx carries both classes", () => {
    const top = read("src/components/shell/TopBar.tsx");
    expect(top).toContain('className="tessera-topbar-heading"');
    expect(top).toContain('className="tessera-topbar-end"');
  });

  it("no longer tiles the project tab hit areas", () => {
    expect(touch?.body).not.toContain("tessera-project-tabs");
  });
});
