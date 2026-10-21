/**
 * Touch targets and narrow-screen layout of analytics and the settings tabs,
 * read from the CSS (jsdom runs no layout): at 375px the Download CSV button,
 * the settings tabs and the Automations buttons are 44px tall, the analytics
 * title keeps its full word, and the analytics tables carry column floors so
 * their own scroll region takes over instead of wrapping a name per letter.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function css(file: string): string {
  return readFileSync(path.join(process.cwd(), "src/components/styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declarations of `selector` inside a `(pointer: coarse), (max-width: 480px)` media block. */
function touchRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const media of source.matchAll(/@media \(pointer: coarse\), \(max-width: 480px\)\s*\{([\s\S]*?)\n\}/g)) {
    const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(media[1] ?? "");
    if (rule) return rule[1] ?? "";
  }
  throw new Error(`no touch rule for ${selector}`);
}

describe("analytics on a phone", () => {
  const analytics = css("analytics.css");

  it("lifts the Download CSV button to a 44px target", () => {
    expect(touchRule(analytics, ".tessera-analytics-csv")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
  });

  it("keeps the title from shrinking so it never truncates to 'Anal…'", () => {
    expect(analytics).toMatch(/\.tessera-analytics-title\s*\{[^}]*flex-shrink:\s*0/);
    expect(analytics).toMatch(/\.tessera-analytics-tabs\s*\{[^}]*min-width:\s*0/);
  });

  it("puts the csv class on the shared download button", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/charts/csv-download.tsx"), "utf8");
    expect(source).toContain('className="tessera-analytics-csv"');
  });

  it("gives every analytics table column a floor", () => {
    for (const file of ["OverviewPanel.tsx", "PlanningPanels.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), "src/components/analytics", file), "utf8");
      const columns = source.match(/\{\s*key: "[A-Za-z]+",[^}]*?header:/g) ?? [];
      const withWidth = source.match(/width: (NAME|TEXT|COUNT|BAR)_COLUMN/g) ?? [];
      expect(columns.length).toBeGreaterThan(0);
      expect(withWidth.length).toBe(columns.length);
    }
  });
});

describe("project settings on a phone", () => {
  const settings = css("project-settings.css");

  it("lifts the settings tabs to 44px", () => {
    expect(touchRule(settings, ".tessera-settings-tabs .astryx-tab")).toMatch(/min-height:\s*var\(--spacing-11\)/);
  });

  it("lifts the Automations buttons to 44px", () => {
    expect(touchRule(settings, ".tessera-settings-action")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    const source = readFileSync(path.join(process.cwd(), "src/components/project-settings/AutomationsSettings.tsx"), "utf8");
    expect(source.match(/className="tessera-settings-action"/g)?.length).toBe(2);
  });
});
