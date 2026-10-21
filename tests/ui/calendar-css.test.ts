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

  it("keeps a narrow cell's chip at a 44px width floor", () => {
    expect(source).toMatch(/\.tessera-cal-day > \.tessera-cal-item \.tessera-cal-open\s*\{[^}]*min-width:\s*calc\(var\(--spacing-10\) \+ var\(--spacing-1\)\)/);
  });
});
