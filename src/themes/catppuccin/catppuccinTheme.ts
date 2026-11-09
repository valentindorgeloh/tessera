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

/**
 * Touch targets (decision 14, docs/contracts/ui.md "Theme"): under a coarse
 * primary pointer or a phone-width viewport, every Astryx control gets a 44px
 * HIT area (WCAG 2.5.5 level AAA, the platform guidance) without growing: the
 * control keeps its drawn size, so the 1440 density and the 375 row look stay.
 * The hit area is an absolutely positioned `::before` centred on the control
 * (the controls keyed below are all positioned already but `top-nav-heading`
 * and `side-nav-heading`, which get `position: relative`). Astryx 0.7.9-0.7.11
 * draws a touch band of its own under a coarse pointer on a Button (so on a
 * toggle button and an input's clear button), a segment, a list row, a labelled
 * checkbox and a radio row, but it stops at half the gap to a neighbour, so it
 * can fall short of 44px (the top bar's sidebar toggle reaches 36px), and
 * Tessera's 44px box is the contract the e2e hit probes hold it to. The two
 * bands sit on different pseudo-elements and both stay, with one collision:
 * Astryx paints a pressed Button's tint on its `::before`, where the box below
 * is. shell.css hands the pseudo-element back to Astryx while a press runs.
 * Its insets are
 * `min(0px, (100% - 44px) / 2)`: negative, so the box reaches 44px, when the
 * control is smaller, and zero when it is already 44px or more, so a wide
 * control only grows on its short axis. It paints nothing and nothing in the
 * layout moves. Two neighbours whose boxes meet share the overlap: the later
 * sibling in the DOM takes it, so keep at least 8px between small controls
 * (or use `tessera-hit--*` in shell.css). A visible 44px box stays only where
 * a list has room by design: menu, option, palette and drawer rows. Switch,
 * Checkbox, bare inputs and the dense rows' hit areas live in
 * src/components/styles/shell.css.
 */
const HIT_INSET = "min(0px, calc((100% - var(--spacing-11)) / 2))";
const hitArea = {
  "::before": {
    content: '""',
    position: "absolute",
    insetBlock: HIT_INSET,
    insetInline: HIT_INSET,
  },
} as const;
// The block axis only: an overlay or a segment that sits flush against a neighbour.
const hitAreaBlock = {
  "::before": {content: '""', position: "absolute", insetBlock: HIT_INSET, insetInline: "0"},
} as const;
const TOUCH_TARGET_COMPONENTS = {
  button: {base: hitArea},
  tab: {base: hitArea},
  // Pointer-only arrows laid over the strip's ends (`display: none` without
  // hover, keyboard and swipe scroll the strip): taller hit area, same width,
  // so it never covers the tab beside it.
  "tab-scroll-button": {base: hitAreaBlock},
  "segmented-control-item": {base: hitAreaBlock},
  // The only one of these that is not positioned already.
  "top-nav-heading": {base: {position: "relative", ...hitArea}},
  // The sidebar's group heading link (32px) between 44px rows: block axis only, it is as wide as the sidebar.
  "side-nav-heading": {base: {position: "relative", ...hitAreaBlock}},
  // Menu, option, palette and drawer rows are lists with room by design: the
  // row itself is 44px (the dropdown's 300px cap is lifted under `dropdown-menu`).
  "dropdown-menu-item": {base: {minBlockSize: "var(--spacing-11)"}},
  "selector-option-row": {base: {minBlockSize: "var(--spacing-11)"}},
  "command-palette-item": {base: {minBlockSize: "var(--spacing-11)"}},
  "side-nav-item": {base: {minBlockSize: "var(--spacing-11)"}},
  // Form fields: the field box keeps its size and a tap on its hit area
  // focuses the input (TextInput focuses it on a click anywhere in the wrapper).
  "text-input": {base: hitArea},
  tokenizer: {base: hitArea},
  "number-input": {base: hitArea},
  "date-input": {base: hitArea},
  "time-input": {base: hitArea},
  "toggle-button": {base: hitArea},
  "input-clear-button": {base: hitArea},
} as const;
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
    // scope banner tokens the same way. The header text and the status icon
    // take --color-on-<status>-muted, which palette.ts sets to the chip label
    // of the status hue, so the Latte yellow and green glyphs that stayed under
    // 3:1 on their tint no longer need a rule of their own.
    banner: {
      base: {
        "--color-text-secondary": "var(--color-text-primary)",
        "--color-neutral": "var(--color-background-surface)",
      },
    },
    // Balanced corners: only avatars and badges are round, so the top bar
    // logo, the tab strip's scroll arrows and calendar days are rounded squares.
    "nav-icon": {base: {borderRadius: "var(--radius-element)"}},
    "tab-scroll-button": {base: {borderRadius: "var(--radius-element)"}},
    // The focus ring of a list row is drawn inside the row. Astryx offsets it
    // outwards, where a list that sits flush against its scroller (cycles,
    // inbox, your work, agent activity) clips the left and right sides.
    "list-item": {base: {outlineOffset: "calc(-1 * var(--focus-outline-width))"}},
    "calendar-day": {base: {borderRadius: "var(--radius-element)"}},
    // The selected sidebar row is shown by colour and the overlay only; Astryx
    // also steps its weight to medium, which makes the label jump (S11).
    "side-nav-item": {"selected:selected": {fontWeight: "var(--font-weight-normal)"}},
  },
  // Two rules with the same body make "(pointer: coarse), (max-width: 480px)":
  // Astryx conditions in one rule are ANDed. `sm` is moved from 640 to 481 so
  // "below sm" is exactly 480px and narrower. Only AppShell reads the named
  // points (its drawer breakpoint is `md`, 768, which stays), so nothing else
  // moves.
  adaptations: {
    widthBreakpoints: {sm: 481, md: 768, lg: 1024, xl: 1280, "2xl": 1536},
    rules: [
      {when: {pointer: "coarse"}, value: {components: TOUCH_TARGET_COMPONENTS}},
      {when: {width: {below: "sm"}}, value: {components: TOUCH_TARGET_COMPONENTS}},
    ],
  },
  // Toasts and other inverted surfaces collapse the accent to their on-colour;
  // the focus ring follows, as the accent ring drops below 3:1 on the red fill.
  // The hover and pressed overlays follow too (S14): they are the page's text
  // colour at 6% and 8-10%, and an inverted surface (a toast) is filled with
  // that same text colour, so the dismiss button showed no hover. On a media
  // surface the overlay is the surface's own on-colour instead.
  onDark: {
    tokens: {
      "--focus-outline-color": "var(--color-on-dark)",
      "--color-overlay-hover": "color-mix(in srgb, var(--color-on-dark) 10%, transparent)",
      "--color-overlay-pressed": "color-mix(in srgb, var(--color-on-dark) 14%, transparent)",
    },
  },
  onLight: {
    tokens: {
      "--focus-outline-color": "var(--color-on-light)",
      "--color-overlay-hover": "color-mix(in srgb, var(--color-on-light) 8%, transparent)",
      "--color-overlay-pressed": "color-mix(in srgb, var(--color-on-light) 12%, transparent)",
    },
  },
  icons: catppuccinIconRegistry,
});
