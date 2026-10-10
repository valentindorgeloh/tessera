import {defineSyntaxTheme, defineTheme} from "@astryxdesign/core/theme";
import {paperIconRegistry} from "./icons";

/**
 * Paper: Stone's warm sheet, with a matcha accent and softer corners.
 * Surfaces stay cream. The green is reserved for accent, links, and selection.
 */
const paperSyntax = defineSyntaxTheme({
  name: "funland-paper",
  tokens: {
    keyword: ["#5a6b32", "#c9d7a4"],
    string: ["#3d684c", "#a3c9b0"],
    comment: ["#8a8175", "#c4baae"],
    number: ["#8a6230", "#e2c48c"],
    function: ["#4d6240", "#b7c9a2"],
    type: ["#5a6b32", "#c9d7a4"],
    variable: ["#2c2822", "#f6f1e6"],
    operator: ["#6e675c", "#c9c0b2"],
    constant: ["#8a6230", "#e2c48c"],
    tag: ["#7a5346", "#e2b8ac"],
    attribute: ["#6d6230", "#d8cc90"],
    property: ["#3d684c", "#a3c9b0"],
    punctuation: ["#6e675c", "#c9c0b2"],
    background: ["#f6f1e6", "#1c1915"],
  },
});

export const paperTheme = defineTheme({
  name: "paper",
  color: {
    accent: ["#5c6a3e", "#c5d4a4"],
    neutralStyle: "warm",
    contrast: "standard",
  },
  typography: {
    scale: {base: 16, ratio: 1.22},
    body: {
      family: "var(--font-body)",
      fallbacks: '"Source Sans 3", "Source Sans Pro", sans-serif',
    },
    heading: {
      family: "var(--font-heading)",
      fallbacks: '"Source Serif 4", "Source Serif Pro", Georgia, serif',
      weights: {1: "semibold", 2: "semibold", 3: "medium", 4: "medium"},
    },
    code: {
      family: "var(--font-code)",
      fallbacks: '"Source Code Pro", ui-monospace, monospace',
    },
  },
  radius: {base: 6, multiplier: 1},
  motion: {fast: 140, medium: 280, slow: 520, ratio: 0.8},
  syntax: paperSyntax,
  tokens: {
    "--color-background-body": ["#f2f1e4", "#1a1914"],
    "--color-background-surface": ["#f8f7ee", "#22211a"],
    "--color-background-card": ["#fffdf6", "#2a291f"],
    "--color-background-muted": ["#e4e6d4", "#3a3c2c"],
    "--color-background-popover": ["#fffdf6", "#2a291f"],
    "--color-border": ["#dddcc8", "#f2f1e41f"],
    "--color-text-primary": ["#2c2822", "#f6f1e6"],
    "--color-text-secondary": ["#6e675c", "#c9c0b2"],
    "--color-shadow": ["#3e481d1a", "#0000004d"],
  },
  icons: paperIconRegistry,
});
