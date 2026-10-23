/**
 * Calendar chip reachability (decision 14), read from
 * src/components/styles/calendar.css (jsdom runs no CSS layout): the Move to
 * date button stays hit-testable with a mouse (it is only invisible until hover,
 * so Playwright and real clicks reach it) and is inert only where there is no
 * hover; a narrow cell's chip keeps a 44px touch-target width.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/components/styles/calendar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the top-level rule whose selector is exactly `selector`. */
function topRule(selector: string): string {
  const match = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`no top-level rule for ${selector}`);
  return match[1] ?? "";
}

describe("calendar chip reachability", () => {
  it("keeps the move button clickable while it is invisible", () => {
    const base = topRule(".tessera-cal-move");
    expect(base).toMatch(/opacity:\s*0/);
    expect(base).not.toContain("pointer-events");
  });

  it("makes the move button inert only where there is no hover", () => {
    expect(source).toMatch(/@media \(hover: none\)\s*\{\s*\.tessera-cal-move\s*\{\s*pointer-events:\s*none;/);
  });

  it("reveals the move button by hover only where there is hover, and by keyboard focus only, never by a tap's focus (visual audit, timeline)", () => {
    // A tap hovers and focuses the chip; showing the button then put it under the finger and the tap's click opened Move to date.
    expect(source).toMatch(/@media \(hover: hover\)\s*\{\s*\.tessera-cal-item:hover \.tessera-cal-move\s*\{\s*opacity:\s*1;\s*\}/);
    expect(source).not.toMatch(/\.tessera-cal-item:focus-within/);
    const focus = /\.tessera-cal-item:has\(:focus-visible\) \.tessera-cal-move,\s*\.tessera-cal-move:focus-visible\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(focus).toMatch(/opacity:\s*1/);
    expect(focus).toMatch(/pointer-events:\s*auto/);
    // No hover rule outside the hover: hover query reaches the move button.
    expect(source.replace(/@media \(hover: hover\)\s*\{[^@]*?\n\}/g, "")).not.toMatch(/\.tessera-cal-item:hover/);
  });

  it("gives the move button no 44px hit area: it would be the whole 44px chip and hide the chip's own tap", () => {
    expect(source).toMatch(/@media \(pointer: coarse\), \(max-width: 480px\)\s*\{[\s\S]*?\.tessera-cal-move::before\s*\{\s*content:\s*none;/);
  });

  it("keeps a narrow cell's chip at a 44px width floor", () => {
    expect(source).toMatch(/\.tessera-cal-day > \.tessera-cal-item \.tessera-cal-open\s*\{[^}]*min-width:\s*calc\(var\(--spacing-10\) \+ var\(--spacing-1\)\)/);
  });
});

describe("calendar chip cursor and overflow label (visual audit, timeline)", () => {
  it("shows the pointer on every chip (a click opens the peek, an archived one too) and the grab cursor only on a chip that can be dragged", () => {
    expect(topRule(".tessera-cal-open")).toMatch(/cursor:\s*pointer/);
    expect(topRule(".tessera-cal-open[data-draggable]")).toMatch(/cursor:\s*grab/);
    expect(topRule(".tessera-cal-open[data-draggable]:active")).toMatch(/cursor:\s*grabbing/);
    expect(topRule(".tessera-cal-open:active")).not.toContain("cursor");
    // Only `data-draggable` chips get grab or grabbing: no other selector sets a cursor on a chip.
    const cursorRules = [...source.matchAll(/([^{}]+)\{[^{}]*cursor:[^{}]*\}/g)].map((match) => (match[1] ?? "").trim());
    expect(cursorRules).toEqual([".tessera-cal-open", ".tessera-cal-open[data-draggable]", ".tessera-cal-open[data-draggable]:active"]);
  });

  it("drops the word from the +N more button in a narrow calendar, so the count stays readable", () => {
    const narrow = /@container tessera-cal \(max-width: 33rem\)\s*\{([\s\S]*?)\n\}\n/.exec(source)?.[1] ?? "";
    expect(narrow).toMatch(/\.tessera-cal-overflow-word\s*\{\s*display:\s*none;/);
  });
});

describe("calendar chip touch-action (decision 14)", () => {
  it("lets a finger scroll over a chip: touch-action: none only for a fine pointer", () => {
    expect(topRule(".tessera-cal-open")).not.toContain("touch-action");
    expect(source).toMatch(/@media \(pointer: fine\)\s*\{\s*\.tessera-cal-open\s*\{\s*touch-action:\s*none;/);
  });
});

describe("calendar gutter, header and today (visual audit T9-T11)", () => {
  it("uses one 16px inline gutter for the toolbar, the weekday row and the grid, at every width", () => {
    expect(topRule(".tessera-cal")).toMatch(/padding-inline:\s*var\(--spacing-4\)/);
    expect(source).not.toMatch(/@media \(max-width: 479px\)/);
    // The toolbar's PanelBar adds no second 16px inside it.
    expect(topRule(".tessera-cal-bar")).toMatch(/padding-inline:\s*0/);
  });

  it("right-aligns the weekday labels over the date numbers, with the number's inset", () => {
    const head = topRule(".tessera-cal-head");
    expect(head).toMatch(/text-align:\s*end/);
    expect(head).toMatch(/padding-inline-end:\s*calc\(var\(--border-width\) \+ var\(--tessera-cal-cell-pad\) \+ var\(--tessera-cal-num-inset\)\)/);
    expect(source).toMatch(/\.tessera-cal-day-head > \.tessera-cal-num\s*\{[^}]*margin-inline-start:\s*auto;[^}]*margin-inline-end:\s*var\(--tessera-cal-num-inset\)/);
  });

  it("marks today with a 20px filled accent circle, not a cell outline", () => {
    const pill = topRule(".tessera-cal-num[data-today]");
    expect(pill).toMatch(/block-size:\s*var\(--spacing-5\)/);
    expect(pill).toMatch(/min-inline-size:\s*var\(--spacing-5\)/);
    expect(pill).toMatch(/border-radius:\s*50%/);
    expect(pill).toMatch(/background:\s*var\(--color-accent\)/);
    expect(pill).toMatch(/color:\s*var\(--color-on-accent\)/);
    expect(source).not.toMatch(/\.tessera-cal-day\[data-today\]/);
  });

  it("tints weekend columns like days outside the month, and keeps their chips visible", () => {
    expect(topRule(".tessera-cal-day[data-weekend],\n.tessera-cal-day[data-outside]")).toMatch(/background:\s*var\(--color-background-muted\)/);
    expect(source).toMatch(/:where\(\.tessera-cal-day\[data-outside\], \.tessera-cal-day\[data-weekend\]\) \.tessera-cal-open/);
  });

  it("stretches the week view's cells to the panel's height", () => {
    expect(topRule(".tessera-cal-week")).toMatch(/grid-auto-rows:\s*1fr/);
    expect(topRule('.tessera-cal[data-view="week"]')).toMatch(/min-block-size:\s*100%/);
  });

  it("lets the week cells hug their chips on a phone: no stretch, no min-block-size, automatic rows (fix round 2026-10-23)", () => {
    const phone = /@media \(max-width: 480px\)\s*\{([\s\S]*?)\n\}\n/.exec(source)?.[1] ?? "";
    expect(phone).toMatch(/\.tessera-cal\[data-view="week"\]\s*\{[^}]*flex:\s*none;[^}]*min-block-size:\s*0;/);
    expect(phone).toMatch(/\.tessera-cal-week,\s*\.tessera-cal\[data-view="week"\] > \.tessera-cal-week\s*\{[^}]*flex:\s*none;[^}]*grid-auto-rows:\s*auto;/);
    // The phone rule is a max-width query alone: a coarse tablet keeps the stretch.
    expect(source).not.toMatch(/@media \(pointer: coarse\)[^{]*\{[^@]*tessera-cal-week/);
    // The wide rules stay as T11 left them.
    expect(topRule(".tessera-cal[data-view=\"week\"]")).toMatch(/flex:\s*1/);
    expect(topRule(".tessera-cal-week")).toMatch(/grid-auto-rows:\s*1fr/);
  });

  it("puts the phone week rule after the wide ones so it wins at equal specificity", () => {
    expect(source.indexOf('@media (max-width: 480px)')).toBeGreaterThan(source.indexOf('.tessera-cal[data-view="week"] > .tessera-cal-week {'));
  });
});

describe("calendar touch (decision 14)", () => {
  it("shows the add button wherever there is no hover, and hides it until hover elsewhere", () => {
    expect(topRule(".tessera-cal-add")).toMatch(/opacity:\s*0/);
    expect(source).toMatch(/@media \(hover: none\)\s*\{\s*\.tessera-cal-add\s*\{\s*opacity:\s*1;/);
  });

  it("gives chips 44px at a coarse pointer and at 480px and narrower", () => {
    expect(source).toMatch(/@media \(pointer: coarse\), \(max-width: 480px\)\s*\{\s*\.tessera-cal-open\s*\{\s*min-height:\s*calc\(var\(--spacing-10\) \+ var\(--spacing-1\)\)/);
  });

  it("opens quick add in a popover whose field is at least 240px wide", () => {
    expect(topRule(".tessera-cal-quickadd")).toMatch(/min-inline-size:\s*calc\(var\(--spacing-12\) \* 5 \+ var\(--spacing-12\) \+ var\(--spacing-4\)\)/);
  });

  it("rings a focused chip with the product's 2px accent ring", () => {
    const ring = topRule(".tessera-cal-open:focus-visible");
    expect(ring).toMatch(/outline:\s*var\(--focus-outline-width\) var\(--focus-outline-style\) var\(--focus-outline-color\)/);
    expect(ring).toMatch(/outline-offset:\s*var\(--focus-outline-offset\)/);
  });
  it("stops the add button's 44px hit box at the first chip, so it never overlaps a chip (visual audit, timeline)", () => {
    const touch = /@media \(pointer: coarse\), \(max-width: 480px\)\s*\{([\s\S]*)\n\}/.exec(source)?.[1] ?? "";
    // The button is size sm (28px): the shell's margin is -8px; the bottom is -4px, the row gap, so the box ends where the chips start.
    expect(touch).toMatch(/\.tessera-cal-day-head \.tessera-cal-add\.tessera-hit\s*\{[^}]*margin-block-end:\s*calc\(\(var\(--size-element-sm\) - var\(--spacing-11\)\) \/ 2 \+ var\(--spacing-1\)\)/);
    // The taller head row is paid back on the date number, only where the button exists.
    expect(touch).toMatch(/\.tessera-cal-day-head:has\(\.tessera-cal-add\) > \.tessera-cal-num\s*\{[^}]*margin-block-end:\s*var\(--spacing-1\)/);
    // Nothing of this applies to a fine pointer on a wide screen.
    expect(source.replace(touch, "")).not.toMatch(/tessera-hit/);
  });
});
