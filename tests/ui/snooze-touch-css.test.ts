/**
 * Touch targets of the Snooze dialog's date and time fields (decision 14, S1),
 * read from src/components/styles/inbox.css (jsdom runs no CSS layout). A bare
 * input cannot carry a pseudo-element, so each input's own box grows to 44px
 * (padding with an equal negative margin), the segments move 12px apart so two
 * 44px areas do not overlap, and the icon buttons get a ::before hit area. All
 * of it applies on a coarse pointer or at 480px and narrower only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/components/styles/inbox.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const dialog = readFileSync(path.join(process.cwd(), "src/components/inbox/SnoozeDialog.tsx"), "utf8");

/** The body of the touch media block that holds the snooze rules. */
function touchBlock(): string {
  const start = source.indexOf(".tessera-snooze-field");
  expect(start).toBeGreaterThan(-1);
  const open = source.lastIndexOf("@media (pointer: coarse), (max-width: 480px)", start);
  expect(open).toBeGreaterThan(-1);
  return source.slice(open, source.indexOf("\n}\n", start) + 3);
}

function rule(block: string, selector: string): string {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(block);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

describe("snooze dialog touch targets", () => {
  it("tags the field so the rules reach only this dialog", () => {
    expect(dialog).toContain('className="tessera-snooze-field"');
    expect(source).not.toMatch(/(^|\n)\.tessera-snooze-field/);
  });

  it("makes each input 44px tall without moving it", () => {
    const body = rule(touchBlock(), ".tessera-snooze-field input");
    expect(body).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(body).toMatch(/padding-block:\s*var\(--spacing-3\)/);
    expect(body).toMatch(/margin-block:\s*calc\(-1 \* var\(--spacing-3\)\)/);
  });

  it("spaces the segments so two 44px areas meet without overlapping", () => {
    expect(rule(touchBlock(), ".tessera-snooze-field")).toMatch(/row-gap:\s*var\(--spacing-3\)/);
  });

  it("gives the icon buttons a 44px ::before hit area that stops at the input", () => {
    const body = rule(touchBlock(), ".tessera-snooze-field .astryx-date-time-input-time-segment > button::before");
    expect(body).toMatch(/inset-block:\s*min\(0px, calc\(\(100% - var\(--spacing-11\)\) \/ 2\)\)/);
    expect(body).toMatch(/inset-inline:\s*calc\(-1 \* var\(--spacing-5\)\) calc\(-1 \* var\(--spacing-2\)\)/);
  });
});
