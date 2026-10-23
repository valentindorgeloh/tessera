/**
 * Settings, estimates and profile stylesheets (visual audit St1-St14, decisions
 * 13 and 14), read as text because jsdom runs no CSS layout: the 44px field and
 * switch-label rules exist only under "(pointer: coarse), (max-width: 480px)",
 * the row wrapping and the webhook header wrap are in place, the sub-label indent
 * is the row's 8px plus 24, hover feedback is limited to hover-capable pointers,
 * and the estimate cells grow.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => strip(readFileSync(path.join(process.cwd(), "src/components/styles", file), "utf8"));

type Block = { prelude: string; body: string };

function blocks(source: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) {
        prelude = source.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (source[i] === "}") {
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
const settings = read("project-settings.css");
const top = blocks(settings);
const touch = top.filter((block) => block.prelude === TOUCH).map((block) => block.body).join("\n");
const hover = top.find((block) => block.prelude === "@media (hover: hover)")?.body ?? "";

/** The declarations of the top-level rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const found = top.find((block) => block.prelude === selector);
  if (!found) throw new Error(`no top-level rule for ${selector}`);
  return found.body;
}

describe("settings touch targets (St3)", () => {
  it("sets the 44px field and switch-label minimums only under the touch media query", () => {
    expect(touch).toMatch(/\.astryx-text-input,[\s\S]*?\.astryx-selector\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    expect(touch).toMatch(/\.astryx-text-input input[\s\S]*?button\[role="combobox"\]\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    expect(touch).toMatch(/\.astryx-switch-label\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    expect(touch).toMatch(/\.tessera-settings-fields \.astryx-item\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    for (const block of top) {
      if (block.prelude === TOUCH) continue;
      expect(`${block.prelude} {${block.body}}`, block.prelude).not.toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    }
  });

  it("scopes the field rules to the settings column and the dialog forms", () => {
    expect(touch).toContain(":is(.tessera-settings-body, .tessera-settings-fields) .astryx-text-input");
  });

  it("gives only the two-letter tab a minimum width, so the strip never squeezes the other labels", () => {
    expect(touch).toMatch(/\.tessera-settings-tab-short\s*\{[^}]*min-inline-size:\s*var\(--spacing-11\)/);
    expect(touch).not.toMatch(/\.tessera-settings-tabs \.astryx-tab\s*\{[^}]*min-inline-size/);
  });
});

describe("settings rows (St5, St6, St8, St10)", () => {
  it("indents a sub-label by the row's 8px plus 24px", () => {
    expect(rule(".tessera-settings-child")).toMatch(/padding-inline-start:\s*calc\(var\(--spacing-2\) \+ var\(--spacing-6\)\)/);
  });

  it("wraps an actor row: the label slot keeps a minimum share and the end cluster drops under it", () => {
    expect(rule(".tessera-settings-row--wrap")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".tessera-settings-row--wrap > :has(.tessera-settings-title)")).toMatch(/min-width:\s*min\(14rem, 100%\)/);
    expect(rule(".tessera-settings-row--wrap > :has(> .tessera-settings-end)")).toMatch(/margin-inline-start:\s*auto/);
  });

  it("lets the danger zone's helper text wrap", () => {
    expect(rule(".tessera-settings-danger .astryx-item")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".tessera-settings-danger .astryx-item > :first-child > *")).toMatch(/white-space:\s*normal/);
  });

  it("pulls the settings lists out by the rows' own 8px, so row titles meet the heading", () => {
    expect(rule(".tessera-settings-list,\n.tessera-settings-danger .astryx-list")).toMatch(/margin-inline:\s*calc\(-1 \* var\(--spacing-2\)\)/);
  });

  it("tints a hovered row and reveals the grip only for hover-capable pointers", () => {
    expect(hover).toMatch(/\.tessera-settings-row:hover\s*\{[^}]*background-image:\s*linear-gradient\(var\(--color-overlay-hover\), var\(--color-overlay-hover\)\)/);
    expect(hover).toMatch(/\.tessera-settings-row \.tessera-row-grip\s*\{[^}]*opacity:\s*0/);
    expect(hover).toMatch(/\.tessera-settings-row:hover \.tessera-row-grip,\s*\.tessera-settings-row:focus-within \.tessera-row-grip\s*\{[^}]*opacity:\s*1/);
    for (const block of top) {
      if (block.prelude === "@media (hover: hover)") continue;
      expect(`${block.prelude} {${block.body}}`, block.prelude).not.toMatch(/tessera-row-grip\s*\{[^}]*opacity:\s*0/);
    }
  });
});

describe("webhook detail (St1, St13)", () => {
  it("wraps the title and the action cluster inside the panel", () => {
    expect(rule(".tessera-webhook-head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".tessera-webhook-head")).toMatch(/max-inline-size:\s*100%/);
    expect(rule(".tessera-webhook-actions")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("gives the signing secret the row's free width", () => {
    expect(rule(".tessera-webhook-secret-field")).toMatch(/flex:\s*1 1 14rem/);
  });
});

describe("estimate dialog rows (St13)", () => {
  const estimates = read("estimates.css");
  it("lets the Value and Description cells grow to fill the body", () => {
    expect(estimates).toMatch(/\.tessera-estimate-value\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0/);
  });
});

describe("profile header and lists (St10, St14)", () => {
  const profile = read("profile.css");
  it("keeps the avatar and tokens at their size and lets only the name narrow", () => {
    expect(profile).toMatch(/\.tessera-profile-title > :not\(\.tessera-profile-name\)\s*\{[^}]*flex-shrink:\s*0/);
    expect(profile).toMatch(/\.tessera-profile-name\s*\{[^}]*min-width:\s*0/);
  });

  it("grows the profile link rows to 44px only for a coarse pointer or a phone", () => {
    const blocksOf = blocks(profile);
    const touchBlock = blocksOf.find((block) => block.prelude === TOUCH);
    expect(touchBlock?.body).toMatch(/\.tessera-profile-list \.astryx-item\s*\{[^}]*min-block-size:\s*var\(--spacing-11\)/);
    for (const block of blocksOf) {
      if (block.prelude === TOUCH) continue;
      expect(`${block.prelude} {${block.body}}`).not.toMatch(/min-block-size/);
    }
  });

  it("pulls profile lists out by the rows' own 8px", () => {
    expect(profile).toMatch(/\.tessera-profile-list\s*\{[^}]*margin-inline:\s*calc\(-1 \* var\(--spacing-2\)\)/);
  });
});
