/**
 * Styling rules of the Relations section and the reaction bar (decisions 55 and
 * 57, Plane facts in docs/drafts/plane-visual-reference.md section 12), read
 * from src/components/styles/collaboration.css and the components (jsdom runs
 * no CSS layout): a reaction chip is a fully round pill with a 1px border, the
 * user's own reaction takes an accent border and a 10% accent fill, nothing
 * blocks touch scrolling, and the small controls get a 44px hit box through
 * the shared `tessera-hit` classes (the 1440 density stays).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeActivity } from "@/components/detail/activity-text";

const root = process.cwd();
const css = readFileSync(path.join(root, "src/components/styles/collaboration.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const reactionBar = readFileSync(path.join(root, "src/components/detail/ReactionBar.tsx"), "utf8");
const relationsList = readFileSync(path.join(root, "src/components/detail/RelationsList.tsx"), "utf8");

function rule(selector: string): string {
  const match = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

describe("reaction chip styling", () => {
  it("draws a fully round pill with a 1px border, centred at the 28px sm height, and keeps 6px inline padding", () => {
    expect(rule(".tessera-reaction")).toMatch(/border-radius:\s*var\(--radius-full\)/);
    expect(rule(".tessera-reaction")).toMatch(/padding-inline:\s*var\(--spacing-1-5\)/);
    const pill = rule(".tessera-reaction::before");
    expect(pill).toMatch(/border:\s*var\(--border-width\) solid var\(--color-border\)/);
    expect(pill).toMatch(/border-radius:\s*var\(--radius-full\)/);
    expect(pill).toMatch(/block-size:\s*var\(--size-element-sm\)/);
    expect(pill).toMatch(/transition:[\s\S]*var\(--duration-fast\)/);
  });

  it("marks the user's own reaction with an accent border and a 10% accent fill", () => {
    const own = rule('.tessera-reaction[aria-pressed="true"]::before');
    expect(own).toMatch(/border-color:\s*var\(--color-accent\)/);
    expect(own).toMatch(/color-mix\(in srgb, var\(--color-accent\) 10%, transparent\)/);
    expect(rule('.tessera-reaction[aria-pressed="true"]')).toMatch(/background-color:\s*transparent/);
  });

  it("wraps the chips, reaches 44px wide under touch and never blocks touch panning", () => {
    expect(rule(".tessera-reactions")).toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 480px\)\s*\{\s*\.tessera-reaction\s*\{\s*min-inline-size:\s*var\(--spacing-11\)/);
    expect(css).not.toContain("touch-action");
  });
});

describe("touch targets (decision 14)", () => {
  it("gives the chips, the add button and the remove button the hit-area expansion", () => {
    expect(reactionBar).toContain('className="tessera-reaction tessera-hit"');
    expect(reactionBar).toMatch(/label="Add reaction"[\s\S]*className="tessera-hit tessera-hit-x"/);
    expect(relationsList).toMatch(/Remove relation to[\s\S]*className="tessera-hit tessera-hit-x"/);
  });

  it("keeps the controls at the sm size, so the desktop density does not change", () => {
    expect(reactionBar).toMatch(/<ToggleButton\s+key=\{summary\.reaction\}\s+size="sm"/);
    expect(relationsList).toMatch(/<IconButton variant="ghost" size="sm" label=\{`Remove relation/);
  });
});

describe("relation activity wording", () => {
  const base = { entity_type: "work_item", old_value: null, old_identifier: null, merged_count: 1 };

  it("reads an added relation with its side and the other item's key", () => {
    expect(describeActivity({ ...base, verb: "added", field: "blocked_by", new_value: "id", new_identifier: "WEB-3" })).toBe("added relation blocked by WEB-3");
    expect(describeActivity({ ...base, verb: "added", field: "implements", new_value: "id", new_identifier: "WEB-9" })).toBe("added relation implements WEB-9");
  });

  it("reads a removed relation with its side and the other item's key (decision 55)", () => {
    expect(describeActivity({ ...base, verb: "removed", field: "blocked_by", old_value: "id", old_identifier: "WEB-3", new_value: null, new_identifier: null })).toBe("removed relation blocked by WEB-3");
    expect(describeActivity({ ...base, verb: "removed", field: "blocking", old_value: "id", old_identifier: "WEB-4", new_value: null, new_identifier: null })).toBe("removed relation blocking WEB-4");
  });

  it("keeps the generic wording for a removal logged before the type was recorded", () => {
    expect(describeActivity({ ...base, verb: "removed", field: "relation", new_value: "id", new_identifier: null })).toBe("removed a relation");
  });
});
