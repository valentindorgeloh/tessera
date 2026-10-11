/**
 * Chart colours (src/components/planning/chart-colors.ts): the token names the
 * burndown and burnup chart reads, and how `resolveChartColors` turns them into
 * raw values for Recharts with a CSS variable fallback for a missing token.
 * `useChartColors` itself only feeds `useTheme().tokens` through it.
 */
import { describe, expect, it } from "vitest";
import { CHART_TOKENS, resolveChartColors, type ChartColorKey } from "@/components/planning/chart-colors";

const KEYS: ChartColorKey[] = ["actual", "ideal", "scope", "today", "grid", "axis", "tooltipSurface", "tooltipText"];

describe("CHART_TOKENS", () => {
  it("names a theme token for every chart colour", () => {
    expect(Object.keys(CHART_TOKENS)).toEqual(KEYS);
    for (const name of Object.values(CHART_TOKENS)) expect(name).toMatch(/^--color-[a-z-]+$/);
  });

  it("draws the lines in blue and purple with the ideal line in secondary text, never green or peach", () => {
    expect(CHART_TOKENS.actual).toBe("--color-data-categorical-blue");
    expect(CHART_TOKENS.scope).toBe("--color-data-categorical-purple");
    expect(CHART_TOKENS.ideal).toBe("--color-text-secondary");
    expect(CHART_TOKENS.today).toBe("--color-border-emphasized");
    for (const name of Object.values(CHART_TOKENS)) expect(name).not.toMatch(/green|peach/);
  });
});

describe("resolveChartColors", () => {
  it("reads every colour from the resolved theme tokens", () => {
    // A fake resolver: each token resolves to a value derived from its name.
    const tokens = Object.fromEntries(Object.values(CHART_TOKENS).map((name) => [name, `value(${name})`]));
    const colors = resolveChartColors(tokens);
    expect(Object.keys(colors)).toEqual(KEYS);
    for (const key of KEYS) expect(colors[key]).toBe(`value(${CHART_TOKENS[key]})`);
  });

  it("falls back to the CSS variable for a token the theme lacks", () => {
    const colors = resolveChartColors({ "--color-data-categorical-blue": "rgb(30, 102, 245)" });
    expect(colors.actual).toBe("rgb(30, 102, 245)");
    expect(colors.scope).toBe("var(--color-data-categorical-purple)");
    expect(colors.grid).toBe("var(--color-border)");
    expect(resolveChartColors({})).toEqual(Object.fromEntries(KEYS.map((key) => [key, `var(${CHART_TOKENS[key]})`])));
  });

  it("ignores tokens it does not use", () => {
    const colors = resolveChartColors({ "--color-accent": "red" });
    expect(Object.values(colors)).not.toContain("red");
  });
});
