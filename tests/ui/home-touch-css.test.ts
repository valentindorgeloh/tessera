/**
 * Touch scrolling on the home reorder surfaces (decisions 14 and 105), read from
 * src/components/styles/home.css (jsdom runs no CSS layout): a finger on a quick
 * link chip or a Manage-widgets row must still scroll, so `touch-action: none`
 * is scoped to fine pointers (chips) or to the grip (widget rows).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/components/styles/home.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the top-level rule whose selector is exactly `selector`. */
function topRule(selector: string): string {
  const match = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`no top-level rule for ${selector}`);
  return match[1] ?? "";
}

describe("home reorder touch handling", () => {
  it("does not block touch panning on the whole chip or widget row", () => {
    expect(topRule(".tessera-quick-link")).not.toContain("touch-action");
    expect(topRule(".tessera-widget-row")).not.toContain("touch-action");
  });

  it("blocks touch panning on chips only for fine pointers", () => {
    expect(source).toMatch(/@media \(pointer: fine\)\s*\{\s*\.tessera-quick-link\s*\{\s*touch-action:\s*none;/);
  });

  it("makes the widget grip the touch handle", () => {
    expect(topRule(".tessera-widget-grip")).toMatch(/touch-action:\s*none/);
  });

  it("grows the widget grip to a 44px touch target on coarse pointers", () => {
    const match = /@media \(pointer: coarse\)[^{]*\{[\s\S]*?\.tessera-widget-grip\s*\{([^}]*)\}/.exec(source);
    expect(match?.[1]).toMatch(/min-width:\s*var\(--spacing-11\)/);
    expect(match?.[1]).toMatch(/min-height:\s*var\(--spacing-11\)/);
  });

  it("gives the Since card's +N more link a 44x44 box on touch that keeps the row height", () => {
    const match = /@media \(pointer: coarse\), \(max-width: 480px\)\s*\{[\s\S]*?\.tessera-home-more\s*\{([^}]*)\}/.exec(source);
    expect(match?.[1]).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(match?.[1]).toMatch(/min-inline-size:\s*var\(--spacing-11\)/);
    expect(match?.[1]).toMatch(/position:\s*relative/);
    expect(match?.[1]).toMatch(/margin-block:\s*calc\(\(var\(--spacing-5\) - var\(--spacing-11\)\) \/ 2\)/);
    expect(readFileSync(path.join(process.cwd(), "src/components/home/SinceLastVisit.tsx"), "utf8")).toContain('className="tessera-home-more"');
  });
});
