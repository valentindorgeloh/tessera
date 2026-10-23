/**
 * Touch targets on the profile screens (decision 14), read from
 * src/components/styles/profile.css (jsdom runs no CSS layout): the link inside a
 * list row and an agent's name in the Agents table reach 44px under a coarse
 * pointer or on a phone, and the row takes the room back so its height holds.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src/components/styles/profile.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const touchBlock = /@media \(pointer: coarse\), \(max-width: 480px\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(touchBlock)?.[1] ?? "";
}

describe("profile touch targets", () => {
  it("grows a list row's link to 44px and returns the room with a negative margin", () => {
    const body = rule(".tessera-profile-list li.astryx-item a");
    expect(body).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(body).toMatch(/margin-block:\s*calc\(\(var\(--spacing-10\) - var\(--spacing-11\)\) \/ 2\)/);
    // The title stays over the subline: centre on the block axis, never align-items (it centres a nowrap title).
    expect(body).toMatch(/justify-content:\s*center/);
    expect(body).not.toContain("align-items");
  });

  it("grows the agent name link to 44px", () => {
    expect(rule(".tessera-profile-link")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
  });

  it("keeps the desktop rows as they are", () => {
    expect(css.replace(touchBlock, "")).not.toContain(".tessera-profile-link");
  });
});
