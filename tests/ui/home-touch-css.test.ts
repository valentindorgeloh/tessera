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

describe("Since row labels", () => {
  it("stay one line with an ellipsis on desktop", () => {
    const rule = topRule(".tessera-home-since-label");
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("wrap to at most two lines at 480px and narrower", () => {
    const match = /@media \(max-width: 480px\)\s*\{\s*\.tessera-home-since-label\s*\{([^}]*)\}/.exec(source);
    expect(match?.[1]).toMatch(/display:\s*-webkit-box/);
    expect(match?.[1]).toMatch(/-webkit-box-orient:\s*vertical/);
    expect(match?.[1]).toMatch(/-webkit-line-clamp:\s*2/);
    expect(match?.[1]).toMatch(/white-space:\s*normal/);
  });

  it("is a Text with the class, not Text maxLines (which clamps inline at every width)", () => {
    const row = readFileSync(path.join(process.cwd(), "src/components/home/SinceLastVisit.tsx"), "utf8");
    expect(row).toContain('<Text className="tessera-home-since-label">');
    // Astryx Text takes no `title`, so the actor run has none (no spread around the types).
    expect(row).toContain('<Text className="tessera-home-since-actor">{actor}</Text>');
    expect(row).not.toMatch(/title: actor|title=\{actor\}/);
    expect(row).toContain("` ${rest}`");
    // The work item key is its own no-wrap run (Astryx textWrap), so it never breaks at its hyphen.
    expect(row).toContain('<Text textWrap="nowrap">{keyed.key}</Text>');
    expect(row).not.toContain("maxLines");
    expect(row).not.toMatch(/aria-label=/);
  });

  it("truncates the actor name on its own at 480px and narrower, not on desktop", () => {
    const match = /@media \(max-width: 480px\)\s*\{[\s\S]*?\.tessera-home-since-actor\s*\{([^}]*)\}/.exec(source);
    expect(match?.[1]).toMatch(/display:\s*inline-block/);
    expect(match?.[1]).toMatch(/max-inline-size:\s*min\(40%,\s*16ch\)/);
    expect(match?.[1]).toMatch(/overflow:\s*hidden/);
    expect(match?.[1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(match?.[1]).toMatch(/white-space:\s*nowrap/);
    expect(match?.[1]).toMatch(/vertical-align:\s*bottom/);
    expect(source.split(".tessera-home-since-actor").length - 1).toBe(1); // only inside the media block
  });
});
