/**
 * Gantt rules read from src/components/styles/gantt.css (jsdom runs no CSS
 * layout): the connector layer's explicit height (an svg with only top and
 * bottom takes its height from its aspect ratio), 44px touch rows and handle
 * hit areas, state-coloured bars, the hover and pressed states, the product
 * focus ring, sticky labels, and the label that steps aside on a short bar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/components/styles/gantt.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet without its at-rule blocks (@media, @container): the rules that apply everywhere. */
const topLevel = source.replace(/^@[^\n{]*\{\n[\s\S]*?\n\}\n/gm, "");

/** The declarations of the top-level rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}{])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(topLevel);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

const FOCUS = /outline:\s*var\(--focus-outline-width\) var\(--focus-outline-style\) var\(--focus-outline-color\)/;

describe("connector layer", () => {
  it("has an explicit height of rows times the row height, and no top/bottom pair", () => {
    const layer = rule(".tessera-gantt-connectors");
    expect(layer).toMatch(/height:\s*calc\(var\(--tessera-gantt-rows\) \* var\(--tessera-gantt-row\)\)/);
    expect(layer).toMatch(/width:\s*calc\(var\(--tessera-gantt-days\) \* var\(--tessera-gantt-day\)\)/);
    expect(layer).not.toMatch(/bottom:/);
  });

  it("draws paths without non-scaling strokes (they are in CSS pixels) and arrowheads in currentColor's rule", () => {
    expect(rule(".tessera-gantt-edge")).not.toContain("vector-effect");
    expect(rule(".tessera-gantt-arrow")).toMatch(/color:\s*var\(--color-border-emphasized\)/);
    expect(rule('.tessera-gantt-arrow[data-conflict]')).toMatch(/color:\s*var\(--color-error\)/);
  });

  it("sits over the tracks' weekend tint", () => {
    expect(rule(".tessera-gantt-connectors")).toMatch(/z-index:\s*1/);
  });
});

describe("label column width (visual audit, timeline)", () => {
  it("scales with the screen between 160px and 256px, so a tablet's bars keep more than half of the panel", () => {
    expect(rule(".tessera-gantt")).toMatch(/--tessera-gantt-label:\s*clamp\(calc\(var\(--spacing-8\) \* 5\), 25vw, calc\(var\(--spacing-8\) \* 8\)\)/);
  });

  it("takes 40% of a phone's width, at most 256px", () => {
    const phone = /@media \(max-width: 480px\)\s*\{\s*\.tessera-gantt\s*\{\s*--tessera-gantt-label:\s*min\(calc\(var\(--spacing-8\) \* 8\), 40vw\)/;
    expect(source).toMatch(phone);
  });
});

describe("touch targets (decision 14)", () => {
  const coarse = /@media \(pointer: coarse\), \(max-width: 480px\)\s*\{([\s\S]*?)\n\}\n/.exec(source)?.[1] ?? "";

  it("makes rows 44px at a coarse pointer or 480px and narrower", () => {
    expect(coarse).toMatch(/\.tessera-gantt\s*\{\s*--tessera-gantt-row:\s*var\(--spacing-11\)/);
  });

  it("makes the open button 44px high and the bar 44px less its insets", () => {
    expect(coarse).toMatch(/\.tessera-gantt-open\s*\{\s*min-block-size:\s*var\(--spacing-11\)/);
    expect(coarse).toMatch(/\.tessera-gantt-bar\s*\{\s*block-size:\s*calc\(var\(--spacing-11\) - var\(--spacing-2\)\)/);
  });

  it("draws a 16px handle whose hit area reaches 44px, outward from the bar", () => {
    expect(coarse).toMatch(/\.tessera-gantt-handle\s*\{\s*inline-size:\s*var\(--spacing-4\)/);
    expect(coarse).toMatch(/\.tessera-gantt-handle::before\s*\{[^}]*inline-size:\s*var\(--spacing-11\)/);
    expect(coarse).toMatch(/\[data-edge="start"\]::before\s*\{\s*inset-inline-end:\s*0/);
    expect(coarse).toMatch(/\[data-edge="end"\]::before\s*\{\s*inset-inline-start:\s*0/);
  });

  it("puts touch-action: none on the handle grips and, for a fine pointer only, the bar; never on a row", () => {
    expect(rule(".tessera-gantt-handle")).toMatch(/touch-action:\s*none/);
    expect(rule(".tessera-gantt-row")).not.toContain("touch-action");
    // A finger scrolls over a bar (the field guide's "grip only" rule), so the bar's own rule has none.
    expect(rule(".tessera-gantt-bar")).not.toContain("touch-action");
    expect(source).toMatch(/@media \(pointer: fine\)\s*\{\s*\.tessera-gantt-bar\s*\{\s*touch-action:\s*none;/);
  });
});

describe("bars", () => {
  it("takes the fill and the edge from the state's colour", () => {
    const bar = rule(".tessera-gantt-bar");
    expect(bar).toMatch(/--tessera-bar-edge:\s*var\(--tessera-bar-color/);
    expect(bar).toMatch(/background-color:\s*color-mix\(in srgb, var\(--tessera-bar-edge\) 25%, var\(--color-background-surface\)\)/);
    expect(bar).toMatch(/border:\s*var\(--border-width\) solid var\(--tessera-bar-edge\)/);
  });

  it("pads the label from the edge and does not clip (the label sticks, the handles reach out)", () => {
    const bar = rule(".tessera-gantt-bar");
    expect(bar).toMatch(/padding-inline:\s*var\(--spacing-2\)/);
    expect(bar).not.toMatch(/overflow:\s*hidden/);
  });

  it("has hover and pressed overlays on the bar and on the open button", () => {
    expect(source).toMatch(/\.tessera-gantt-bar:hover\s*\{[^}]*--color-overlay-hover/);
    expect(rule(".tessera-gantt-bar:active")).toMatch(/--color-overlay-pressed/);
    expect(source).toMatch(/\.tessera-gantt-open:hover\s*\{[^}]*--color-overlay-hover/);
    expect(rule(".tessera-gantt-open:active")).toMatch(/--color-overlay-pressed/);
  });

  it("shows a 4px grip on the handle while the bar is hovered or focused", () => {
    expect(rule(".tessera-gantt-handle::after")).toMatch(/inline-size:\s*var\(--spacing-1\)/);
    expect(rule(".tessera-gantt-handle::after")).toMatch(/inset-block:\s*25%/);
    expect(source).toMatch(/\.tessera-gantt-bar:hover \.tessera-gantt-handle::after[^{]*\{\s*background:\s*var\(--color-border-emphasized\)/);
  });

  it("hides the label of a bar under 64px instead of clipping it", () => {
    expect(rule(".tessera-gantt-bar")).toMatch(/container:\s*tessera-bar \/ inline-size/);
    expect(source).toMatch(/@container tessera-bar \(width < 2\.875rem\)\s*\{\s*\.tessera-gantt-bar-label\s*\{\s*display:\s*none/);
  });
});

describe("focus rings", () => {
  it("uses the product's 2px accent ring on the open button, bar and handle", () => {
    for (const selector of [".tessera-gantt-open:focus-visible", ".tessera-gantt-bar:focus-visible", ".tessera-gantt-handle:focus-visible"]) {
      const body = rule(selector);
      expect(body, selector).toMatch(FOCUS);
      expect(body, selector).toMatch(/outline-offset:\s*var\(--focus-outline-offset\)/);
    }
  });
});

describe("sticky labels", () => {
  it("sticks a bar's label at the left edge of the track, past the label column", () => {
    const label = rule(".tessera-gantt-bar-label");
    expect(label).toMatch(/position:\s*sticky/);
    expect(label).toMatch(/inset-inline-start:\s*calc\(var\(--tessera-gantt-label\) \+ var\(--spacing-2\)\)/);
  });

  it("sets the bar label in primary text, which reads on every tinted fill", () => {
    expect(rule(".tessera-gantt-bar-label")).toMatch(/color:\s*var\(--color-text-primary\)/);
  });

  it("sticks a header band's label inside a clipped, non-scrolling band", () => {
    expect(rule(".tessera-gantt-month")).toMatch(/overflow:\s*clip/);
    const label = rule(".tessera-gantt-month-label");
    expect(label).toMatch(/position:\s*sticky/);
    expect(label).toMatch(/inset-inline-start:\s*var\(--tessera-gantt-label\)/);
  });
});
