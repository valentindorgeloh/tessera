/**
 * Work-items stylesheet rules of the visual-audit fixes (lane L; decisions 14 and
 * 112), read from src/components/styles/{work-items,bulk}.css because jsdom runs
 * no CSS layout: the filter tokens shrink and wrap, the Display popover is capped,
 * the group header and quick-add line up with the row key, a selected row is tinted,
 * and the 44px hit areas exist only under "(pointer: coarse), (max-width: 480px)" so
 * the 1440 density stays.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => strip(readFileSync(path.join(process.cwd(), file), "utf8"));
const items = read("src/components/styles/work-items.css");
const bulk = read("src/components/styles/bulk.css");

type Block = { prelude: string; body: string };

/** The blocks at one nesting level of `source`. */
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

const TOUCH = "@media (pointer: coarse), (max-width: 480px)";
const norm = (selector: string) => selector.replace(/\s+/g, " ").trim();

/** The declarations of the first rule in `source` whose selector list contains `selector` (top level of `source`). */
function rule(source: string, selector: string): string {
  const found = blocks(source).find((block) => !block.prelude.startsWith("@") && block.prelude.split(",").some((part) => norm(part) === norm(selector)));
  if (!found) throw new Error(`no rule for ${selector}`);
  return found.body;
}

const media = (source: string, prelude: string) => blocks(source).filter((block) => block.prelude === prelude);

describe("filter tokens (L1)", () => {
  it("keeps the end lane clear while tokens show, and lets a token narrow with an ellipsis", () => {
    expect(rule(items, ".tessera-wi-search .astryx-tokenizer:has(.astryx-token)")).toMatch(/padding-inline-end:\s*calc\(var\(--spacing-12\) \* 2 \+ var\(--spacing-6\)\)/);
    const wrapper = rule(items, ".tessera-wi-search .astryx-tokenizer > :has(> .astryx-token)");
    expect(wrapper).toMatch(/min-width:\s*0/);
    expect(wrapper).toMatch(/max-width:\s*100%/);
    expect(wrapper).toMatch(/flex-shrink:\s*1/);
    expect(rule(items, ".tessera-wi-search .astryx-token > :not(button:last-child)")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(items, ".tessera-wi-search .astryx-token > button:last-child")).toMatch(/flex-shrink:\s*0/);
  });

  it("gives the field its own line on a phone while tokens show, and keeps the one 44px row otherwise", () => {
    const phone = media(items, "@media (max-width: 480px)").flatMap((block) => blocks(block.body));
    const filter = phone.find((block) => block.prelude === ".tessera-wi-filter:has(.astryx-token)");
    const field = phone.find((block) => block.prelude === ".tessera-wi-filter:has(.astryx-token) > .astryx-power-search");
    expect(filter?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(filter?.body).toMatch(/row-gap:\s*var\(--spacing-2\)/);
    expect(field?.body).toMatch(/flex:\s*1 1 100%/);
    // Without tokens the field and Advanced share the row, as before the touch rework: nothing wraps it.
    expect(phone.find((block) => block.prelude === ".tessera-wi-filter")).toBeUndefined();
  });
});

describe("Display popover (L2)", () => {
  it("caps the body at 480px less the surface padding, scrolls, and allows 600px on a 1024px tall window", () => {
    const body = rule(items, ".tessera-wi-display");
    expect(body).toMatch(/max-block-size:\s*calc\(min\(calc\(var\(--spacing-12\) \* 10\), calc\(100dvh - var\(--spacing-12\) \* 2\)\) - var\(--spacing-6\) - var\(--border-width\) \* 2\)/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    const tall = media(items, "@media (min-height: 1024px)").flatMap((block) => blocks(block.body)).find((block) => block.prelude === ".tessera-wi-display");
    expect(tall?.body).toMatch(/max-block-size:\s*calc\(var\(--spacing-12\) \* 12 - var\(--border-width\) \* 2\)/);
  });
});

describe("list gutter (L3)", () => {
  it("starts the group marker at the row key's x and takes the header checkbox out of the flow", () => {
    expect(rule(items, ".tessera-wi-group-header")).toMatch(/padding-inline-start:\s*calc\(var\(--spacing-3\) - var\(--border-width\)\)/);
    const select = rule(items, ".tessera-wi-group-select");
    expect(select).toMatch(/position:\s*absolute/);
    expect(select).toMatch(/inset-inline-start:\s*calc\(var\(--spacing-3\) \+ var\(--spacing-4\)\)/);
  });

  it("puts the quick-add plus at the row inset and its text at the key's x", () => {
    expect(rule(items, ".tessera-wi-quickadd")).toMatch(/padding-inline-start:\s*0/);
    expect(rule(items, ".tessera-wi-quickadd .astryx-button")).toMatch(/column-gap:\s*var\(--spacing-5\)/);
  });
});

describe("row states and chips (L4, L9, L10, L11, L13)", () => {
  it("renders an overdue date in the text-safe red", () => {
    expect(rule(items, ".tessera-wi-chip[data-overdue]")).toMatch(/color:\s*var\(--color-text-red\)/);
  });

  it("tints a selected row with the accent wash and leaves the colour only, so the hover overlay paints over it", () => {
    const selected = rule(bulk, ".tessera-wi-row[data-selected]");
    expect(selected).toMatch(/background-color:\s*var\(--color-accent-muted\)/);
    expect(selected).not.toMatch(/background-image|background:/);
  });

  it("paints the hover overlay on the group band as an image, for hover-capable pointers", () => {
    const hover = media(items, "@media (hover: hover)").flatMap((block) => blocks(block.body)).find((block) => block.prelude === ".tessera-wi-group .astryx-collapsible-trigger:hover");
    expect(hover?.body).toMatch(/background-image:\s*linear-gradient\(var\(--color-overlay-hover\), var\(--color-overlay-hover\)\)/);
    expect(hover?.body).not.toMatch(/background-color/);
  });

  it("makes tokens and counts the same 24px chip as the controls", () => {
    const chips = rule(items, ".tessera-wi-props .astryx-token");
    expect(chips).toMatch(/height:\s*calc\(var\(--size-element-sm\) - var\(--spacing-1\)\)/);
    expect(chips).toMatch(/border-radius:\s*var\(--radius-inner\)/);
  });

  it("balances the empty state's text", () => {
    expect(rule(items, ".tessera-wi-empty")).toMatch(/text-wrap:\s*balance/);
  });
});

describe("touch targets (L7, L8)", () => {
  const touch = media(items, TOUCH).flatMap((block) => blocks(block.body));
  const find = (selector: string) => touch.find((block) => norm(block.prelude) === norm(selector));

  it("leaves the selector triggers, the icon chip, the date chip and the filter input at their drawn size (the hit area is the theme's and shell.css's pseudo-element)", () => {
    for (const block of touch) {
      expect(`${block.prelude} {${block.body}}`, block.prelude).not.toMatch(/\[role="combobox"\]/);
      expect(`${block.prelude} {${block.body}}`, block.prelude).not.toMatch(/\.tessera-wi-(chip|search)[^{]*\{[^}]*(min-block-size|min-inline-size|height)\s*:/);
    }
    expect(items).not.toMatch(/\.tessera-wi-chip::before/);
  });

  it("keeps the group band a 44px target, and spaces wrapped chip lines 8px apart so a chip's hit area takes at most 2px of the line above", () => {
    expect(find(".tessera-wi-group .astryx-collapsible-trigger")?.body).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(find(".tessera-wi-props, .tessera-wi-form-props")?.body).toMatch(/row-gap:\s*var\(--spacing-2\)/);
    // The quick-add and the dialog's name input are TextInputs: the wrapper carries the hit area, the input takes no 44px box.
    expect(touch.some((block) => /\.tessera-wi-quickadd input|\.tessera-wi-field input/.test(block.prelude))).toBe(false);
  });

  it("keeps the row lines 8px apart and the last chip line inside the row, and meets the checkbox's area with the key", () => {
    // 24px chip + 10px of hit area above it, 8px between the key line and the chips: 2px of the key's area is taken.
    const row = find(".tessera-wi-row")?.body ?? "";
    expect(row).toMatch(/row-gap:\s*var\(--spacing-2\)/);
    // The last chip line's 10px of hit area below it clears the next row and the quick-add button.
    expect(row).toMatch(/padding-block-end:\s*var\(--spacing-2\)/);
    // The checkbox's 44px input (12px each side of its 20px box) ends where the key button starts.
    expect(find(".tessera-wi-select")?.body).toMatch(/margin-inline-end:\s*var\(--spacing-2\)/);
  });

  it("lowers the title's minimum so key and title share a line at 375 and 360px (the 104px start slot left no room for 14rem)", () => {
    const title = find(".tessera-wi-row > :has(.tessera-wi-title)")?.body ?? "";
    expect(title).toMatch(/min-width:\s*min\(10rem, 100%\)/);
    // The wide rule keeps 14rem (a 352px list beside a peek); only the touch arm lowers it.
    expect(rule(items, ".tessera-wi-row > :has(.tessera-wi-title)")).toMatch(/min-width:\s*min\(14rem, 100%\)/);
    // 104 (checkbox, margin, key) + 8 (gap) + 160 fits the 314px content of a 360px row.
    expect(104 + 8 + 160).toBeLessThanOrEqual(360 - 18 - 28);
  });

  it("keeps a filter token's label and cross at their drawn size and lets Astryx space wrapped token lines", () => {
    expect(find(".tessera-wi-search .astryx-tokenizer")).toBeUndefined();
    expect(find(".tessera-wi-search .astryx-token > button")).toBeUndefined();
    expect(find(".tessera-wi-search .astryx-token > button:last-child")).toBeUndefined();
    // The filter input is only positioned (it paints above the tokenizer's hit-area pseudo-element, so it is the top element at its own centre); it takes no 44px box.
    const input = find(".tessera-wi-search .astryx-tokenizer input")?.body ?? "";
    expect(input).toMatch(/position:\s*relative/);
    expect(input).not.toMatch(/min-block-size|min-inline-size|height|margin|padding/);
    // The suggestion list's options are rows of a list: 44px boxes.
    expect(find(".astryx-typeahead-dropdown [role=\"option\"]")?.body).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
  });

  it("moves the group marker, its checkbox and the quick-add text 8px right on a phone, where the row's checkbox margin moves the key", () => {
    expect(find(".tessera-wi-group-header")?.body).toMatch(/padding-inline-start:\s*calc\(var\(--spacing-3\) - var\(--border-width\) \+ var\(--spacing-2\)\)/);
    expect(find(".tessera-wi-group-select")?.body).toMatch(/inset-inline-start:\s*calc\(var\(--spacing-3\) \+ var\(--spacing-4\) \+ var\(--spacing-2\)\)/);
    expect(find(".tessera-wi-quickadd .astryx-button")?.body).toMatch(/column-gap:\s*calc\(var\(--spacing-5\) \+ var\(--spacing-2\)\)/);
  });

  it("applies no 44px rule outside the touch media query", () => {
    for (const source of [items, bulk]) {
      const outside = blocks(source)
        .filter((block) => block.prelude !== TOUCH)
        .map((block) => block.body)
        .join("\n");
      expect(outside).not.toMatch(/spacing-11/);
    }
  });

  it("shows the select checkbox where nothing hovers, and keeps the reveal for the others", () => {
    const none = media(bulk, "@media (hover: none)").flatMap((block) => blocks(block.body)).find((block) => block.prelude === ".tessera-wi-select");
    expect(none?.body).toMatch(/opacity:\s*1/);
    expect(rule(bulk, ".tessera-wi-select")).toMatch(/opacity:\s*0/);
  });

  it("never blocks touch panning on a row or a chip", () => {
    expect(items).not.toMatch(/touch-action/);
    expect(bulk).not.toMatch(/touch-action/);
  });
});

describe("bulk bar on a phone (L6)", () => {
  it("flows the actions in the bar on wide screens and scrolls them in one row under the count on a phone", () => {
    expect(rule(bulk, ".tessera-bulk-actions")).toMatch(/display:\s*contents/);
    expect(rule(bulk, ".tessera-bulk-summary")).toMatch(/display:\s*contents/);
    const phone = media(bulk, "@media (max-width: 480px)").flatMap((block) => blocks(block.body));
    const bar = phone.find((block) => block.prelude === ".tessera-bulk-bar");
    expect(bar?.body).toMatch(/flex-direction:\s*column/);
    expect(bar?.body).toMatch(/padding-block:\s*0/);
    const actions = phone.find((block) => block.prelude === ".tessera-bulk-actions");
    expect(actions?.body).toMatch(/display:\s*flex/);
    expect(actions?.body).toMatch(/flex-wrap:\s*nowrap/);
    expect(actions?.body).toMatch(/overflow-x:\s*auto/);
  });
});
