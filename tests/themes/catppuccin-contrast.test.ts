import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCENT_TOKENS,
  CHIP_TOKENS,
  PALETTE_KEY_COLOURS,
  SEMANTIC_TOKENS,
  STATUS_TOKENS,
  type ModePair,
} from "@/themes/catppuccin/palette";

/**
 * WCAG 2.x contrast of the Catppuccin theme (src/themes/catppuccin/palette.ts)
 * in both modes. Translucent tokens are painted over the surface they sit on
 * before measuring, as the browser composites them. Text needs 4.5:1, icons,
 * control outlines and the focus ring 3:1 (WCAG 1.4.3 and 1.4.11).
 * tests/themes/catppuccin-wiring.test.ts checks the generated theme uses these tokens.
 */

type Rgb = [r: number, g: number, b: number];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MODES = [
  ["Latte", 0],
  ["Frappé", 1],
] as const;

const SURFACES = {
  body: SEMANTIC_TOKENS["--color-background-body"],
  surface: SEMANTIC_TOKENS["--color-background-surface"],
  card: SEMANTIC_TOKENS["--color-background-card"],
  muted: SEMANTIC_TOKENS["--color-background-muted"],
  popover: SEMANTIC_TOKENS["--color-background-popover"],
} satisfies Record<string, ModePair>;

const TEXT = 4.5;
const ICON = 3;
/** Astryx keeps a surface's own text when it already reads at this ratio (useAutoMediaMode AMBIENT_READS_AT). */
const AMBIENT_READS_AT = 3;

function channels(hex: string): { rgb: Rgb; alpha: number } {
  expect(hex, `${hex} is #rrggbb or #rrggbbaa`).toMatch(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
  const at = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  return { rgb: [at(1), at(3), at(5)], alpha: hex.length === 9 ? at(7) / 255 : 1 };
}

/** Paints colours bottom-first; the bottom one must be opaque. */
function paint(bottom: string, ...layers: string[]): Rgb {
  const base = channels(bottom);
  expect(base.alpha, `${bottom} is opaque`).toBe(1);
  return layers.reduce<Rgb>((under, layer) => {
    const { rgb, alpha } = channels(layer);
    return [0, 1, 2].map((i) => rgb[i] * alpha + under[i] * (1 - alpha)) as Rgb;
  }, base.rgb);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `opacity` of a rule in an app stylesheet, as the alpha suffix of an 8-digit hex. */
function cssOpacityHex(file: string, selector: string): string {
  const css = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{[^}]*?opacity:\\s*([\\d.]+)`).exec(css);
  expect(match, `${selector} sets an opacity in ${file}`).not.toBeNull();
  return Math.round(Number(match![1]) * 255)
    .toString(16)
    .padStart(2, "0");
}

describe("catppuccin palette contrast", () => {
  describe.each(MODES)("%s", (_name, mode) => {
    const surfaces = Object.entries(SURFACES).map(([name, pair]) => [name, pair[mode]] as const);
    const rowSurfaces = surfaces.filter(([name]) => name !== "muted");

    /**
     * The label and focus ring Astryx gives content on an inverted fill
     * (toasts, inverted tooltips): the surface's own text when it already
     * reads at 3:1, otherwise the better of on-dark/on-light, with the ring
     * following the on-colour (catppuccinTheme.ts onDark/onLight).
     */
    function mediaContent(fill: Rgb): { label: Rgb; ring: Rgb } {
      const ambient = paint(SEMANTIC_TOKENS["--color-text-primary"][mode]);
      if (ratio(ambient, fill) >= AMBIENT_READS_AT) return { label: ambient, ring: paint(ACCENT_TOKENS["--color-accent"][mode]) };
      const onDark = paint(SEMANTIC_TOKENS["--color-on-dark"][mode]);
      const onLight = paint(SEMANTIC_TOKENS["--color-on-light"][mode]);
      const label = ratio(onDark, fill) >= ratio(onLight, fill) ? onDark : onLight;
      return { label, ring: label };
    }

    it.each([
      ["text-primary", SEMANTIC_TOKENS["--color-text-primary"]],
      ["text-secondary", SEMANTIC_TOKENS["--color-text-secondary"]],
      ["text-accent", ACCENT_TOKENS["--color-text-accent"]],
    ])("%s reads on every surface", (_token, pair) => {
      for (const [surface, background] of surfaces) {
        expect(ratio(paint(pair[mode]), paint(background)), surface).toBeGreaterThanOrEqual(TEXT);
      }
    });

    it("icon-secondary is visible on every surface", () => {
      for (const [surface, background] of surfaces) {
        const icon = SEMANTIC_TOKENS["--color-icon-secondary"][mode];
        expect(ratio(paint(icon), paint(background)), surface).toBeGreaterThanOrEqual(ICON);
      }
    });

    // The focus ring is the accent (Astryx --focus-outline-color), drawn 3px
    // outside the control on whatever surface it sits on.
    it("the focus ring is visible on every surface", () => {
      for (const [surface, background] of surfaces) {
        expect(ratio(paint(ACCENT_TOKENS["--color-accent"][mode]), paint(background)), surface).toBeGreaterThanOrEqual(ICON);
      }
    });

    // Inputs, selectors, checkbox and radio rings and the off switch track
    // (catppuccinTheme.ts components) are outlined with border-emphasized. The
    // board's quick-add input sits in a muted column, so muted counts too.
    it("control outlines are visible on every surface", () => {
      for (const [surface, background] of surfaces) {
        const outline = SEMANTIC_TOKENS["--color-border-emphasized"][mode];
        expect(ratio(paint(outline), paint(background)), surface).toBeGreaterThanOrEqual(ICON);
      }
    });

    it("the off switch track stands out from its thumb", () => {
      const track = SEMANTIC_TOKENS["--color-border-emphasized"][mode];
      const thumb = SURFACES.surface[mode];
      expect(ratio(paint(track), paint(thumb))).toBeGreaterThanOrEqual(ICON);
    });

    // Selected SideNav rows, segmented controls, avatars and badges sit on
    // neutral, pressed rows on overlay-pressed, selected list rows (labels and
    // descriptions) on accent-muted. Rows live on the body, surfaces, cards and
    // menus; the muted wells (board columns) hold cards, not rows.
    it.each([
      ["text-primary", "neutral", SEMANTIC_TOKENS["--color-neutral"]],
      ["text-primary", "overlay-pressed", SEMANTIC_TOKENS["--color-overlay-pressed"]],
      ["text-primary", "accent-muted", ACCENT_TOKENS["--color-accent-muted"]],
      ["text-secondary", "neutral", SEMANTIC_TOKENS["--color-neutral"]],
      ["text-secondary", "overlay-pressed", SEMANTIC_TOKENS["--color-overlay-pressed"]],
      ["text-secondary", "accent-muted", ACCENT_TOKENS["--color-accent-muted"]],
    ] as const)("%s reads on %s fills", (token, _fill, fill) => {
      const text = SEMANTIC_TOKENS[`--color-${token}`][mode];
      for (const [surface, background] of rowSurfaces) {
        expect(ratio(paint(text), paint(background, fill[mode])), surface).toBeGreaterThanOrEqual(TEXT);
      }
    });

    // Board cards are ClickableCards: their hover overlay paints over the
    // content, so avatar initials (text-secondary on neutral) sit under it too.
    // The DisplayMenu segmented control hovers the same way inside a menu.
    it("secondary text on neutral fills reads under the hover overlay", () => {
      const text = SEMANTIC_TOKENS["--color-text-secondary"][mode];
      const fills = [SEMANTIC_TOKENS["--color-neutral"][mode], SEMANTIC_TOKENS["--color-overlay-hover"][mode]];
      for (const [surface, background] of [
        ["card", SURFACES.card[mode]],
        ["popover", SURFACES.popover[mode]],
      ] as const) {
        expect(ratio(paint(text), paint(background, ...fills)), surface).toBeGreaterThanOrEqual(TEXT);
      }
    });

    // --color-error is also text: destructive menu rows keep it when
    // highlighted (hover or keyboard focus) on the menu surface. The press
    // overlay lasts only while the pointer is down and is not measured.
    it("error text reads on every surface and on a highlighted menu row", () => {
      const text = STATUS_TOKENS["--color-error"][mode];
      for (const [surface, background] of surfaces) {
        expect(ratio(paint(text), paint(background)), surface).toBeGreaterThanOrEqual(TEXT);
      }
      const highlighted = paint(SURFACES.popover[mode], SEMANTIC_TOKENS["--color-overlay-hover"][mode]);
      expect(ratio(paint(text), highlighted), "highlighted row").toBeGreaterThanOrEqual(TEXT);
    });

    // Palette text tokens are chip labels, FieldStatus messages and, through
    // Astryx's default syntax mapping, the code colours on --color-background-muted.
    it.each(Object.keys(PALETTE_KEY_COLOURS))("text-%s reads on every surface", (key) => {
      const text = CHIP_TOKENS[`--color-text-${key}`][mode];
      for (const [surface, background] of surfaces) {
        expect(ratio(paint(text), paint(background)), surface).toBeGreaterThanOrEqual(TEXT);
      }
    });

    // FieldStatus paints text-<colour> on the matching status tint.
    it.each([
      ["error", "red", STATUS_TOKENS["--color-error-muted"]],
      ["warning", "yellow", STATUS_TOKENS["--color-warning-muted"]],
      ["success", "green", STATUS_TOKENS["--color-success-muted"]],
    ] as const)("%s messages read on their tint", (_status, key, tint) => {
      const text = CHIP_TOKENS[`--color-text-${key}`][mode];
      for (const [surface, background] of surfaces) {
        expect(ratio(paint(text), paint(background, tint[mode])), surface).toBeGreaterThanOrEqual(TEXT);
      }
    });

    // Toasts and other media surfaces (Astryx MediaTheme): the label Astryx
    // picks reads, and the focus ring around their buttons stays visible.
    it.each([
      ["inverted", SEMANTIC_TOKENS["--color-background-inverted"]],
      ["error-inverted", STATUS_TOKENS["--color-background-error-inverted"]],
    ] as const)("media labels and focus rings read on the %s fill", (_name, fill) => {
      const background = paint(fill[mode]);
      const { label, ring } = mediaContent(background);
      expect(ratio(label, background), "label").toBeGreaterThanOrEqual(TEXT);
      expect(ratio(ring, background), "focus ring").toBeGreaterThanOrEqual(ICON);
    });

    it("the tab close glyph is visible on the tab bar", () => {
      const tabBar = SURFACES.surface[mode];
      const glyph = SEMANTIC_TOKENS["--color-icon-secondary"][mode] + cssOpacityHex("src/components/styles/shell.css", ".tessera-tab-close");
      expect(ratio(paint(tabBar, glyph), paint(tabBar))).toBeGreaterThanOrEqual(ICON);
      const hovered = paint(tabBar, SEMANTIC_TOKENS["--color-overlay-hover"][mode]);
      expect(ratio(paint(tabBar, SEMANTIC_TOKENS["--color-overlay-hover"][mode], glyph), hovered), "hovered tab").toBeGreaterThanOrEqual(ICON);
    });

    it.each([
      ["on-accent", ACCENT_TOKENS["--color-on-accent"], ACCENT_TOKENS["--color-accent"]],
      ["on-success", STATUS_TOKENS["--color-on-success"], STATUS_TOKENS["--color-success"]],
      ["on-error", STATUS_TOKENS["--color-on-error"], STATUS_TOKENS["--color-error"]],
      ["on-error (inverted)", STATUS_TOKENS["--color-on-error"], STATUS_TOKENS["--color-background-error-inverted"]],
      ["on-warning", STATUS_TOKENS["--color-on-warning"], STATUS_TOKENS["--color-warning"]],
    ])("%s reads on its fill", (_token, label, fill) => {
      expect(ratio(paint(label[mode]), paint(fill[mode]))).toBeGreaterThanOrEqual(TEXT);
    });

    it.each(Object.keys(PALETTE_KEY_COLOURS))("%s chip label reads on its tint", (key) => {
      const text = CHIP_TOKENS[`--color-text-${key}`][mode];
      const tint = CHIP_TOKENS[`--color-background-${key}`][mode];
      for (const [surface, background] of surfaces) {
        expect(ratio(paint(text), paint(background, tint)), surface).toBeGreaterThanOrEqual(TEXT);
      }
    });
  });
});
