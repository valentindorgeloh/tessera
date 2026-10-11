"use client";

/**
 * Chart colours (docs/contracts/ui.md "Burndown and burnup chart"). Recharts
 * writes colours into SVG attributes, so the chart needs raw values rather
 * than `var(--…)` references: `useTheme().tokens` resolves every theme token
 * for the active mode (Latte or Frappé) and is memoized per theme and mode.
 * Only token names live here, never a colour literal. Blue and purple are
 * close in luminance, so the lines also differ by dash pattern and are named
 * in the legend text (WCAG 1.4.1); green and peach fail 3:1 on Latte and are
 * not used. tests/themes/catppuccin-contrast.test.ts checks the strokes.
 */
import { useMemo } from "react";
import { useTheme } from "@astryxdesign/core/theme";

export const CHART_TOKENS = {
  actual: "--color-data-categorical-blue",
  ideal: "--color-text-secondary",
  scope: "--color-data-categorical-purple",
  today: "--color-border-emphasized",
  grid: "--color-border",
  axis: "--color-text-secondary",
  tooltipSurface: "--color-background-popover",
  tooltipText: "--color-text-primary",
} as const;

export type ChartColorKey = keyof typeof CHART_TOKENS;

/** Resolves CHART_TOKENS for the current theme and mode; a token the theme lacks falls back to its CSS variable. */
export function resolveChartColors(tokens: Readonly<Record<string, string>>): Record<ChartColorKey, string> {
  const entries = (Object.keys(CHART_TOKENS) as ChartColorKey[]).map((key) => {
    const name = CHART_TOKENS[key];
    return [key, tokens[name] ?? `var(${name})`] as const;
  });
  return Object.fromEntries(entries) as Record<ChartColorKey, string>;
}

export function useChartColors(): Record<ChartColorKey, string> {
  const { tokens } = useTheme();
  return useMemo(() => resolveChartColors(tokens), [tokens]);
}
