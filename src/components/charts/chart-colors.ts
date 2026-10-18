"use client";

/**
 * Analytics chart colours. Burndown keeps its own helper at
 * `planning/chart-colors.ts`; this list is the ten categorical data tokens
 * in a fixed order, with green and orange last because those hues fail 3:1
 * on Latte. Axes and tooltips use the same tokens as the burndown chart.
 * Only token names live here.
 */
import { useMemo } from "react";
import { useTheme } from "@astryxdesign/core/theme";

export const CATEGORICAL_TOKENS = [
  "--color-data-categorical-blue",
  "--color-data-categorical-purple",
  "--color-data-categorical-red",
  "--color-data-categorical-cyan",
  "--color-data-categorical-pink",
  "--color-data-categorical-teal",
  "--color-data-categorical-indigo",
  "--color-data-categorical-brown",
  "--color-data-categorical-orange",
  "--color-data-categorical-green",
] as const;

export const CHART_CHROME = {
  grid: "--color-border",
  axis: "--color-text-secondary",
  tooltipSurface: "--color-background-popover",
  tooltipText: "--color-text-primary",
} as const;

export const TREND_CREATED_TOKEN = "--color-data-categorical-blue";
export const TREND_COMPLETED_TOKEN = "--color-data-categorical-purple";
/** Completed series is dashed so the two areas are not colour alone. */
export const TREND_COMPLETED_DASH = "4 4";

/** Token name at `index`, wrapping after the ten categorical tokens. */
export function categoricalToken(index: number): string {
  const safe = index < 0 ? 0 : index;
  return CATEGORICAL_TOKENS[safe % CATEGORICAL_TOKENS.length] ?? CATEGORICAL_TOKENS[0];
}

/** Resolves one token for the active theme; a missing token stays a CSS variable. */
export function paintToken(tokens: Readonly<Record<string, string>>, name: string): string {
  return tokens[name] ?? `var(${name})`;
}

export function useTokenColor(): (name: string) => string {
  const { tokens } = useTheme();
  return useMemo(() => (name: string) => paintToken(tokens, name), [tokens]);
}
