import {defineTheme, syntaxTokenDefaults} from "@astryxdesign/core/theme";
import {catppuccinIconRegistry} from "./icons";
import {
  ACCENT_TOKENS,
  CHIP_TOKENS,
  DATA_TOKENS,
  LATTE,
  FRAPPE,
  SEMANTIC_TOKENS,
  SHADOW_TOKENS,
  STATUS_TOKENS,
} from "./palette";

/**
 * Catppuccin: Frappé in dark mode (the app default) and Latte in light mode,
 * with a Mauve accent. Every colour token is a `[latte, frappe]` pair from
 * `./palette`, so one theme serves both schemes and `<Theme mode>` picks one.
 *
 * Corners: inner 4 (chips), element 8 (buttons, inputs), container 12 (cards,
 * menus, dialogs) and 16 for page-level panels. Nested surfaces follow the
 * concentric rule from `astryx docs shape`.
 *
 * Code highlighting uses Astryx's default syntax mapping (keyword → accent
 * text, string → green text, …), declared here inside the theme so its
 * `var(--color-text-*)` references resolve to the Catppuccin text tokens and
 * every syntax colour inherits their contrast.
 */

const hairline = {
  borderWidth: "var(--border-width)",
  borderStyle: "solid",
  borderColor: "var(--color-border)",
};

export const catppuccinTheme = defineTheme({
  name: "catppuccin",
  color: {
    accent: [LATTE.mauve, FRAPPE.mauve],
    neutralStyle: "cool",
    contrast: "standard",
  },
  typography: {
    scale: {base: 14, ratio: 1.2},
    body: {
      family: "var(--font-body)",
      fallbacks: '"Source Sans 3", "Source Sans Pro", sans-serif',
    },
    heading: {
      family: "var(--font-body)",
      fallbacks: '"Source Sans 3", "Source Sans Pro", sans-serif',
      weights: {1: "semibold", 2: "semibold", 3: "semibold", 4: "medium"},
    },
    code: {
      family: "var(--font-code)",
      fallbacks: '"Source Code Pro", ui-monospace, monospace',
    },
  },
  radius: {base: 4, multiplier: 1},
  motion: {fast: 140, medium: 280, slow: 520, ratio: 0.8},
  tokens: {
    ...syntaxTokenDefaults,
    ...SEMANTIC_TOKENS,
    ...ACCENT_TOKENS,
    ...STATUS_TOKENS,
    ...CHIP_TOKENS,
    ...DATA_TOKENS,
    ...SHADOW_TOKENS,
    // The scale's 7 × base gives 28px; Tessera's panels stop at 16.
    "--radius-page": "16px",
    "--radius-chat": "16px",
  },
  components: {
    // Menus sit on mantle in Frappé, the sidebar's colour, and on base in
    // Latte, the content's colour; a hairline keeps the panel's edge visible
    // where the soft Catppuccin shadow alone does not. ContextMenu paints its
    // own surface, so it needs the same rule. The browser's default styles for
    // <dialog> and [popover] set color: CanvasText (pure white or black), which
    // would reach any glyph that inherits its colour.
    popover: {base: {...hairline, color: "var(--color-text-primary)"}},
    "context-menu": {base: {...hairline, color: "var(--color-text-primary)"}},
    dialog: {base: {color: "var(--color-text-primary)"}},
    // The off track is the gray chip tint, too faint to outline a control
    // (WCAG 1.4.11 asks 3:1), so it takes the control-outline colour that
    // inputs, checkboxes and radios read from --color-border-emphasized. Only
    // the off state: the checked track keeps Astryx's accent, hover tint and
    // forced-colors Highlight.
    switch: {
      base: {':not([data-checked="checked"])': {backgroundColor: "var(--color-border-emphasized)"}},
    },
    // A banner's status tint moves its backdrop towards the text colour, and a
    // secondary button stacks the neutral fill and the hover overlay on top, so
    // secondary text and button labels drop below 4.5:1 (Frappé warning and
    // success, Latte error). Inside a banner, secondary text reads as primary
    // and secondary buttons sit on the plain surface; Astryx's own themes
    // scope banner tokens the same way.
    banner: {
      base: {
        "--color-text-secondary": "var(--color-text-primary)",
        "--color-neutral": "var(--color-background-surface)",
      },
    },
    // Latte yellow and green glyphs stay under 3:1 on their tint, so the status
    // icon takes the matching text colour, as FieldStatus messages do.
    "banner-icon": {
      "status:warning": {color: "var(--color-text-yellow)"},
      "status:success": {color: "var(--color-text-green)"},
    },
    // Balanced corners: only avatars and badges are round, so the SideNav
    // logo, the tab strip's scroll arrows and calendar days are rounded squares.
    "nav-icon": {base: {borderRadius: "var(--radius-element)"}},
    "tab-scroll-button": {base: {borderRadius: "var(--radius-element)"}},
    "calendar-day": {base: {borderRadius: "var(--radius-element)"}},
  },
  // Toasts and other inverted surfaces collapse the accent to their on-colour;
  // the focus ring follows, as the accent ring drops below 3:1 on the red fill.
  onDark: {tokens: {"--focus-outline-color": "var(--color-on-dark)"}},
  onLight: {tokens: {"--focus-outline-color": "var(--color-on-light)"}},
  icons: catppuccinIconRegistry,
});
