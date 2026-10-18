/**
 * Palette key to a chart token (docs/drafts/p9-plan.md U4). Recharts needs a
 * resolved colour, and these names are the tokens `useTokenColor` resolves.
 * State groups follow the seeded state colours; priorities follow the same
 * palette keys (decision 22). No colour literal lives here.
 */
import type { PaletteColor } from "@/lib/tessera/types";

/** Seeded state colours (`DEFAULT_STATES`): gray, blue, yellow, green, red. */
export const STATE_GROUP_PALETTE: Record<string, PaletteColor> = {
  backlog: "gray",
  unstarted: "blue",
  started: "yellow",
  completed: "green",
  cancelled: "red",
  triage: "gray",
};

export const PRIORITY_PALETTE: Record<string, PaletteColor> = {
  urgent: "red",
  high: "orange",
  medium: "yellow",
  low: "blue",
  none: "gray",
};

export const STATE_GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;
export const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"] as const;

/**
 * Palette key to a theme token. Yellow and gray have no categorical slot:
 * yellow uses the warning token (the theme's yellow) and gray the neutral
 * data token.
 */
export const PALETTE_DATA_TOKEN: Record<PaletteColor, string> = {
  red: "--color-data-categorical-red",
  orange: "--color-data-categorical-orange",
  yellow: "--color-warning",
  green: "--color-data-categorical-green",
  teal: "--color-data-categorical-teal",
  cyan: "--color-data-categorical-cyan",
  blue: "--color-data-categorical-blue",
  purple: "--color-data-categorical-purple",
  pink: "--color-data-categorical-pink",
  gray: "--color-data-neutral",
};

export function paletteToken(color: PaletteColor | null): string | null {
  return color === null ? null : PALETTE_DATA_TOKEN[color];
}
