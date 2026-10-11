/**
 * Catppuccin palette (MIT, https://github.com/catppuccin/palette) and Tessera's
 * semantic mapping onto Astryx tokens. Latte fills the light slot and Frappé the
 * dark slot of every `[light, dark]` pair. Pure data: `catppuccinTheme.ts` builds
 * the theme from it and `tests/themes/catppuccin-contrast.test.ts` measures it.
 * Code highlighting keeps Astryx's default syntax mapping, which reads these
 * text tokens (`--color-syntax-string` is `--color-text-green`, and so on).
 */

export const LATTE = {
  rosewater: "#dc8a78",
  flamingo: "#dd7878",
  pink: "#ea76cb",
  mauve: "#8839ef",
  red: "#d20f39",
  maroon: "#e64553",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
  text: "#4c4f69",
  subtext1: "#5c5f77",
  subtext0: "#6c6f85",
  overlay2: "#7c7f93",
  overlay1: "#8c8fa1",
  overlay0: "#9ca0b0",
  surface2: "#acb0be",
  surface1: "#bcc0cc",
  surface0: "#ccd0da",
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
} as const;

export const FRAPPE = {
  rosewater: "#f2d5cf",
  flamingo: "#eebebe",
  pink: "#f4b8e4",
  mauve: "#ca9ee6",
  red: "#e78284",
  maroon: "#ea999c",
  peach: "#ef9f76",
  yellow: "#e5c890",
  green: "#a6d189",
  teal: "#81c8be",
  sky: "#99d1db",
  sapphire: "#85c1dc",
  blue: "#8caaee",
  lavender: "#babbf1",
  text: "#c6d0f5",
  subtext1: "#b5bfe2",
  subtext0: "#a5adce",
  overlay2: "#949cbb",
  overlay1: "#838ba7",
  overlay0: "#737994",
  surface2: "#626880",
  surface1: "#51576d",
  surface0: "#414559",
  base: "#303446",
  mantle: "#292c3c",
  crust: "#232634",
} as const;

/** Mocha crust: the one Catppuccin colour dark enough to label Latte's green and yellow fills at 4.5:1. */
const MOCHA_CRUST = "#11111b";

export type CatppuccinColour = keyof typeof LATTE;
/** `[light, dark]`, the shape Astryx compiles to `light-dark()`. */
export type ModePair = [light: string, dark: string];

/** The same Catppuccin colour in both flavours. */
function pair(colour: CatppuccinColour): ModePair {
  return [LATTE[colour], FRAPPE[colour]];
}

/** A Catppuccin colour at an opacity per mode, as 8-digit hex. */
function tint(colour: CatppuccinColour, light: number, dark: number): ModePair {
  return [LATTE[colour] + alphaHex(light), FRAPPE[colour] + alphaHex(dark)];
}

function alphaHex(opacity: number): string {
  return Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Surfaces, text, icons, borders and overlays (`astryx docs tokens/tokens-color`). */
export const SEMANTIC_TOKENS = {
  "--color-background-body": pair("mantle"),
  "--color-background-surface": pair("base"),
  "--color-background-card": pair("base"),
  // Frappé menus sit on mantle, as in Catppuccin's own ports: on surface0 the
  // mauve accent (links, selected rows) drops below 4.5:1.
  "--color-background-popover": [LATTE.base, FRAPPE.mantle],
  "--color-background-muted": [LATTE.crust, FRAPPE.mantle],
  "--color-background-inverted": pair("text"),
  "--color-border": pair("surface0"),
  // Control outlines: inputs, selectors, checkbox and radio rings, and the off
  // switch track (catppuccinTheme.ts) need 3:1 (WCAG 1.4.11). Latte overlay2 is
  // nudged one step darker so the board's quick-add input keeps 3:1 on crust.
  "--color-border-emphasized": ["#7b7e92", FRAPPE.overlay1],
  "--color-text-primary": pair("text"),
  // subtext1 in both flavours: subtext0 drops below 4.5:1 on base (Latte) and on
  // the neutral and mauve-tinted fills behind segments, avatars and selected rows (Frappé).
  "--color-text-secondary": pair("subtext1"),
  "--color-text-disabled": pair("overlay0"),
  "--color-icon-primary": pair("text"),
  // Latte overlay2 is 2.99:1 on crust (board columns), so Latte icons step up to subtext0.
  "--color-icon-secondary": [LATTE.subtext0, FRAPPE.overlay2],
  "--color-icon-disabled": pair("overlay0"),
  // Light enough that secondary text on it (the selected SideNav row's count,
  // segmented controls, avatar initials) keeps 4.5:1, also under the hover
  // overlay a ClickableCard paints over the avatars on board cards.
  "--color-neutral": tint("text", 0.08, 0.1),
  "--color-overlay": [LATTE.text + alphaHex(0.4), FRAPPE.crust + alphaHex(0.6)],
  "--color-overlay-hover": tint("text", 0.06, 0.06),
  "--color-overlay-pressed": tint("text", 0.08, 0.1),
  "--color-skeleton": pair("surface1"),
  "--color-track": pair("surface1"),
  "--color-shadow": [LATTE.text + alphaHex(0.1), FRAPPE.crust + alphaHex(0.3)],
  // Labels on media surfaces (toasts, inverted tooltips) and the hover tint
  // Astryx mixes into controls: Catppuccin's lightest and darkest, not white and black.
  "--color-on-dark": [LATTE.base, LATTE.base],
  "--color-on-light": [FRAPPE.crust, FRAPPE.crust],
  "--color-tint-hover": pair("text"),
} satisfies Record<string, ModePair>;

/**
 * Mauve accent. On-accent is owned here because a hand-set accent does not
 * re-derive it. Accent text (links) defaults to the accent itself; Latte mauve
 * drops to 4.45:1 on mantle, so Latte links use a deeper mauve (the purple chip
 * label) while Frappé keeps the palette colour.
 */
export const ACCENT_TOKENS = {
  "--color-accent": pair("mauve"),
  // Selected rows: light enough that secondary text on them keeps 4.5:1.
  "--color-accent-muted": tint("mauve", 0.08, 0.2),
  "--color-on-accent": [LATTE.base, FRAPPE.crust],
  "--color-text-accent": ["#6b1dc3", FRAPPE.mauve],
} satisfies Record<string, ModePair>;

/**
 * Status colours: palette fills, each with the palette colour that labels it at
 * 4.5:1. Latte error text (destructive menu rows) is a deeper red, because
 * Latte red drops to 4.4:1 under the hover overlay; the inverted error fill
 * keeps the palette red. The muted tints match the chip tint, the strength the
 * chip labels (FieldStatus messages) were tuned for.
 */
export const STATUS_TOKENS = {
  "--color-success": pair("green"),
  "--color-success-muted": tint("green", 0.2, 0.2),
  "--color-on-success": [MOCHA_CRUST, FRAPPE.crust],
  "--color-error": ["#b80b32", FRAPPE.red],
  "--color-error-muted": tint("red", 0.2, 0.2),
  "--color-on-error": [LATTE.base, FRAPPE.crust],
  "--color-background-error-inverted": pair("red"),
  "--color-warning": pair("yellow"),
  "--color-warning-muted": tint("yellow", 0.2, 0.2),
  "--color-on-warning": [MOCHA_CRUST, FRAPPE.crust],
} satisfies Record<string, ModePair>;

/** Stored palette keys (`src/lib/tessera/schemas.ts`) → Catppuccin colours. */
export const PALETTE_KEY_COLOURS = {
  red: "red",
  orange: "peach",
  yellow: "yellow",
  green: "green",
  teal: "teal",
  cyan: "sky",
  blue: "blue",
  purple: "mauve",
  pink: "pink",
  gray: "overlay2",
} as const satisfies Record<string, CatppuccinColour>;

export type PaletteKey = keyof typeof PALETTE_KEY_COLOURS;

/** Chip fill opacity per mode (`--color-background-<key>`). */
export const CHIP_TINT = { light: 0.2, dark: 0.2 } as const;

/**
 * Chip label colours (`--color-text-<key>`). The raw Catppuccin hues sit below
 * 4.5:1 on their own tint, so each label is the same hue moved in OKLCH
 * lightness until it passes on the tint over base, mantle and crust: deeper in
 * Latte, lighter in Frappé (the same idea as Astryx's default chip text).
 * Gray labels use the palette text colour, as Astryx's gray chips do.
 */
export const CHIP_TEXT: Record<PaletteKey, ModePair> = {
  red: ["#9e001f", "#ffa0a1"],
  orange: ["#9f2c00", "#fbad85"],
  yellow: ["#844b00", FRAPPE.yellow],
  green: ["#136400", "#a8d38b"],
  teal: ["#005d63", "#8bd0c6"],
  cyan: ["#005c8a", FRAPPE.sky],
  blue: ["#0546c2", "#a2bfff"],
  purple: ["#6b1dc3", "#dbb1f6"],
  pink: ["#8c3977", FRAPPE.pink],
  gray: pair("text"),
};

/** `--color-{background,border,icon,text}-<key>` for every palette key (Token chips, Card colour variants). */
export const CHIP_TOKENS: Record<string, ModePair> = Object.fromEntries(
  (Object.entries(PALETTE_KEY_COLOURS) as [PaletteKey, CatppuccinColour][]).flatMap(([key, colour]) => [
    [`--color-background-${key}`, tint(colour, CHIP_TINT.light, CHIP_TINT.dark)],
    [`--color-border-${key}`, pair(colour)],
    [`--color-icon-${key}`, pair(colour)],
    [`--color-text-${key}`, CHIP_TEXT[key]],
  ]),
);

/** Categorical chart hues (P9 charts). Sequential ramps keep the Astryx defaults. */
export const DATA_TOKENS = {
  "--color-data-categorical-blue": pair("blue"),
  "--color-data-categorical-orange": pair("peach"),
  "--color-data-categorical-purple": pair("mauve"),
  "--color-data-categorical-green": pair("green"),
  "--color-data-categorical-pink": pair("pink"),
  "--color-data-categorical-cyan": pair("sapphire"),
  "--color-data-categorical-red": pair("red"),
  "--color-data-categorical-teal": pair("teal"),
  "--color-data-categorical-brown": pair("flamingo"),
  "--color-data-categorical-indigo": pair("lavender"),
  "--color-data-neutral": pair("overlay1"),
} satisfies Record<string, ModePair>;

/**
 * Elevation. Shadow lists cannot be a `[light, dark]` pair (that would wrap the
 * whole list in `light-dark()`), so each colour stop carries its own.
 */
const shadowInk = (light: number, dark: number) =>
  `light-dark(${LATTE.text}${alphaHex(light)}, ${FRAPPE.crust}${alphaHex(dark)})`;
const inset = (token: string) => `inset 0px 0px 0px 2px color-mix(in srgb, var(${token}) 50%, transparent)`;

export const SHADOW_TOKENS = {
  "--shadow-low": `0px 1px 1px ${shadowInk(0.08, 0.3)}, 0px 2px 8px ${shadowInk(0.08, 0.3)}`,
  "--shadow-med": `0px 1px 2px ${shadowInk(0.1, 0.35)}, 0px 2px 12px ${shadowInk(0.1, 0.35)}`,
  "--shadow-high": `0px 2px 2px ${shadowInk(0.1, 0.4)}, 0px 8px 24px ${shadowInk(0.14, 0.5)}`,
  "--shadow-inset-hover": `inset 0px 0px 0px 2px light-dark(${LATTE.overlay0}66, ${FRAPPE.overlay0}66)`,
  "--shadow-inset-selected": inset("--color-accent"),
  "--shadow-inset-success": inset("--color-success"),
  "--shadow-inset-warning": inset("--color-warning"),
  "--shadow-inset-error": inset("--color-error"),
} satisfies Record<string, string>;
