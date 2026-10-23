/**
 * Phone layout of the workspace settings and the profile (visual audit St14 and
 * the settings lane), read from source and CSS because jsdom runs no layout:
 *  - the five tabs of both strips fit at 375px (smaller tab padding, strip to the
 *    panel's right edge) instead of resting half hidden under the scroll button;
 *  - the backups, exports and webhook delivery tables carry column floors, so a
 *    file name wraps at its hyphens, headers do not truncate and the table's own
 *    scroll region takes over;
 *  - the exports and delivery status is a dot with its word;
 *  - the estimates empty state is not a warning triangle.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const css = (file: string) => read(`src/components/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the `@media (max-width: 480px)` block. */
function phoneBlock(source: string): string {
  const start = source.lastIndexOf("@media (max-width: 480px) {");
  if (start === -1) throw new Error("no phone block");
  return source.slice(start);
}

describe("tab strips fit a phone", () => {
  it("profile tabs: 6px padding, strip to the panel edge, still on the 16px inset", () => {
    const block = phoneBlock(css("profile.css"));
    expect(block).toContain(".tessera-profile-tabs.astryx-tab-list");
    expect(block).toMatch(/padding-inline:\s*calc\(var\(--spacing-1\) \* 1\.5\)/);
    expect(block).toMatch(/width:\s*calc\(100% \+ var\(--tessera-profile-tab-pad\) \+ var\(--spacing-4\)\)/);
    expect(block).toMatch(/max-width:\s*none/);
    expect(block).toMatch(/margin-inline-start:\s*calc\(-1 \* var\(--tessera-profile-tab-pad\)\)/);
  });

  it("at 360px the profile tabs take 4px and the analytics tabs 8px, so all of them still fit at rest", () => {
    const profile = css("profile.css").slice(css("profile.css").lastIndexOf("@media (max-width: 374px) {"));
    expect(profile).toMatch(/--tessera-profile-tab-pad:\s*var\(--spacing-1\)/);
    expect(profile).toMatch(/\.tessera-profile-tabs \.astryx-tab\s*\{[^}]*padding-inline:\s*var\(--spacing-1\)/);
    const analytics = css("analytics.css").slice(css("analytics.css").indexOf("@media (max-width: 374px) {"));
    expect(analytics).toMatch(/\.tessera-analytics-tabs\.astryx-tab-list\s*\{[^}]*width:\s*calc\(100% \+ var\(--spacing-2\)\);[^}]*margin-inline-start:\s*calc\(-1 \* var\(--spacing-2\)\)/);
    expect(analytics).toMatch(/\.tessera-analytics-tabs \.astryx-tab\s*\{[^}]*padding-inline:\s*var\(--spacing-2\)/);
  });

  it("the workspace settings strip carries the class, the project settings strip does not", () => {
    expect(read("src/components/workspace-settings/WorkspaceSettingsChrome.tsx")).toContain('className="tessera-settings-tabs tessera-settings-tabs--workspace"');
    expect(read("src/components/project-settings/SettingsTabs.tsx")).not.toContain("--workspace");
  });

  it("the profile strip carries the class", () => {
    expect(read("src/components/profile/ProfileScreen.tsx")).toContain('className="tessera-profile-tabs"');
  });

  it("workspace settings tabs: 8px padding, strip to the panel edge, still on the 16px inset", () => {
    const block = phoneBlock(css("project-settings.css"));
    expect(block).toContain(".tessera-settings-tabs--workspace.astryx-tab-list:first-child");
    expect(block).toMatch(/\.tessera-settings-tabs--workspace \.astryx-tab\s*\{[^}]*padding-inline:\s*var\(--spacing-2\)/);
    expect(block).toMatch(/width:\s*calc\(100% \+ var\(--tessera-settings-tab-pad\) \+ var\(--spacing-4\)\)/);
    expect(block).toMatch(/max-width:\s*none/);
  });
});

describe("settings tables keep readable columns", () => {
  const widths = read("src/components/workspace-settings/table-widths.ts");

  it("names the floors once", () => {
    expect(widths).toMatch(/FILE_NAME_COLUMN = proportional\(1, \{ minWidth: \d{3} \}\)/);
    expect(widths).toMatch(/ACTIONS_COLUMN = pixel\(/);
    expect(widths).toMatch(/ACTION_COLUMN = pixel\(/);
  });

  it("gives every backups column a width", () => {
    const source = read("src/components/backups/BackupsScreen.tsx");
    expect(source.match(/width: [A-Z_]+_COLUMN(_FOLDED)?/g)).toHaveLength(6);
  });

  it("gives every exports column a width", () => {
    const source = read("src/components/exports/ExportsScreen.tsx");
    expect(source.match(/width: [A-Z_]+_COLUMN(_FOLDED)?/g)).toHaveLength(7);
  });

  it("gives every delivery column a width", () => {
    const source = read("src/components/webhooks/WebhookScreen.tsx");
    expect(source.match(/width: [A-Z_]+_COLUMN(_FOLDED)?/g)).toHaveLength(8);
  });

  it("folds the exports and delivery tables under their full floors so the row actions stay in view (no hidden swipe)", () => {
    expect(widths).toMatch(/EXPORTS_FULL_WIDTH = 584/);
    expect(widths).toMatch(/DELIVERIES_FULL_WIDTH = 688/);
    // Folded floors: every remaining column fits the 325px phone column.
    const folded = (name: string) => Number(new RegExp(`${name} = proportional\\(1, \\{ minWidth: (\\d+) \\}\\)`).exec(widths)?.[1]);
    expect(folded("TITLE_COLUMN_FOLDED") + 104 + 88).toBeLessThanOrEqual(325);
    expect(folded("CODE_COLUMN_FOLDED") + 104 + 56).toBeLessThanOrEqual(325);
    const exportsSource = read("src/components/exports/ExportsScreen.tsx");
    expect(exportsSource).toContain("useNarrowContainer(EXPORTS_FULL_WIDTH)");
    expect(exportsSource).toContain("[foldedNameColumn, statusColumn, actionsColumn]");
    const hooksSource = read("src/components/webhooks/WebhookScreen.tsx");
    expect(hooksSource).toContain("useNarrowContainer(DELIVERIES_FULL_WIDTH)");
    expect(hooksSource).toContain("[foldedEventColumn, statusColumn, redeliverColumn]");
  });

  it("shows the status as a dot with its word (colour is not the only signal)", () => {
    expect(read("src/components/exports/ExportsScreen.tsx")).toContain("<StatusLabel");
    expect(read("src/components/webhooks/WebhookScreen.tsx")).toContain("<StatusLabel");
    expect(read("src/components/exports/ExportsScreen.tsx")).not.toContain("<StatusDot");
    expect(read("src/components/webhooks/WebhookScreen.tsx")).not.toContain("<StatusDot");
  });
});

describe("estimates empty state", () => {
  it("uses a neutral icon and the replace dialog says Replace", () => {
    const settings = read("src/components/estimates/EstimatesSettings.tsx");
    expect(settings).toContain("icon={HashIcon}");
    expect(settings).not.toContain("EstimateIcon");
    expect(read("src/components/estimates/EstimateDialog.tsx")).toContain('mode === "replace" ? "Replace" : "Create"');
  });
});
