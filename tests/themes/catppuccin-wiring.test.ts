import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syntaxTokenDefaults } from "@astryxdesign/core/theme";
import { describe, expect, it } from "vitest";
import {
  ACCENT_TOKENS,
  CHIP_TOKENS,
  DATA_TOKENS,
  SEMANTIC_TOKENS,
  SHADOW_TOKENS,
  STATUS_TOKENS,
  type ModePair,
} from "@/themes/catppuccin/palette";

/**
 * The built theme (src/themes/catppuccin/catppuccin.css, from `astryx theme
 * build`) carries what tests/themes/catppuccin-contrast.test.ts measures: the
 * palette tokens, the syntax mapping inside the theme scope, every component
 * override and the media focus ring. `npm run check:theme` keeps the build in
 * step with catppuccinTheme.ts; this keeps catppuccinTheme.ts in step with the palette.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const THEME_DIR = path.join(REPO_ROOT, "src/themes/catppuccin");
const css = fs.readFileSync(path.join(THEME_DIR, "catppuccin.css"), "utf8");

/** Declarations of the theme's root token block (`@layer astryx-theme` → `@scope (…catppuccin…)` → `:scope`). */
function themeScopeTokens(): Map<string, string> {
  const layer = css.indexOf("@layer astryx-theme {");
  expect(layer, "astryx-theme layer").toBeGreaterThan(-1);
  const scopeOpen = css.indexOf(":scope {", layer);
  const scopeClose = css.indexOf("\n  }", scopeOpen);
  expect(scopeOpen, "theme :scope block").toBeGreaterThan(-1);
  const block = css.slice(scopeOpen, scopeClose);
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string | null {
  const at = css.indexOf(`${selector} {`);
  return at === -1 ? null : css.slice(at + selector.length + 2, css.indexOf("}", at));
}

describe("catppuccin theme wiring", () => {
  const tokens = themeScopeTokens();

  it.each(
    Object.entries({ ...SEMANTIC_TOKENS, ...ACCENT_TOKENS, ...STATUS_TOKENS, ...CHIP_TOKENS, ...DATA_TOKENS } as Record<string, ModePair>),
  )("%s is the palette pair", (token, [light, dark]) => {
    expect(tokens.get(token)?.toLowerCase()).toBe(`light-dark(${light}, ${dark})`.toLowerCase());
  });

  it.each(Object.entries(SHADOW_TOKENS))("%s is the palette shadow", (token, value) => {
    expect(tokens.get(token)).toBe(value);
  });

  // Astryx's own syntax fallback sits on :root, where var(--color-text-*)
  // would resolve to Astryx's default text colours rather than Catppuccin's.
  it.each(Object.entries(syntaxTokenDefaults))("%s resolves inside the theme scope", (token, value) => {
    expect(tokens.get(token)).toBe(value);
  });

  it("outlines only the off switch track, leaving the checked track to Astryx", () => {
    const trackRules = [...css.matchAll(/^\s*(\.astryx-switch(?![-\w])[^{]*)\{/gm)].map((match) => match[1].trim());
    expect(trackRules).toEqual(['.astryx-switch:not([data-checked="checked"])']);
    expect(ruleBody(trackRules[0])).toContain("background-color: var(--color-border-emphasized)");
  });

  it.each([
    [".astryx-popover", ["border-width: var(--border-width)", "border-color: var(--color-border)", "color: var(--color-text-primary)"]],
    [".astryx-context-menu", ["border-width: var(--border-width)", "border-color: var(--color-border)", "color: var(--color-text-primary)"]],
    [".astryx-dialog", ["color: var(--color-text-primary)"]],
    [".astryx-banner", ["--color-text-secondary: var(--color-text-primary)", "--color-neutral: var(--color-background-surface)"]],
    ['.astryx-banner-icon[data-status="warning"]', ["color: var(--color-text-yellow)"]],
    ['.astryx-banner-icon[data-status="success"]', ["color: var(--color-text-green)"]],
    [".astryx-nav-icon", ["border-radius: var(--radius-element)"]],
    [".astryx-tab-scroll-button", ["border-radius: var(--radius-element)"]],
    [".astryx-calendar-day", ["border-radius: var(--radius-element)"]],
  ])("%s carries its override", (selector, declarations) => {
    const body = ruleBody(selector);
    expect(body, `${selector} rule`).not.toBeNull();
    for (const declaration of declarations) expect(body).toContain(declaration);
  });

  // 14px working density: body and labels at 14px, supporting text at 12px.
  it.each([
    ["--font-size-base", "0.875rem"],
    ["--font-size-sm", "0.75rem"],
    ["--text-body-size", "var(--font-size-base)"],
    ["--text-supporting-size", "var(--font-size-sm)"],
  ])("%s is %s", (token, value) => {
    expect(tokens.get(token)).toBe(value);
  });

  it("the focus ring follows the on-colour on inverted surfaces", () => {
    expect(ruleBody('[data-astryx-media="dark"]')).toContain("--focus-outline-color: var(--color-on-dark)");
    expect(ruleBody('[data-astryx-media="light"]')).toContain("--focus-outline-color: var(--color-on-light)");
  });

  it("uses no private Astryx variables", () => {
    for (const file of ["catppuccinTheme.ts", "palette.ts", "catppuccin.css"]) {
      expect(fs.readFileSync(path.join(THEME_DIR, file), "utf8"), file).not.toMatch(/--_[\w-]/);
    }
  });
});
