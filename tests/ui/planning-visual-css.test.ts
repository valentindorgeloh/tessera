/**
 * The planning, views, intake and projects visual fixes (visual audit lane
 * "planning"), read from the stylesheets and sources because jsdom runs no CSS
 * layout: the intake search keeps its width, the side-panel lists sit on the
 * 16px inset, the touch hit areas exist only under "(pointer: coarse),
 * (max-width: 480px)" (decision 14), the module row keeps fixed avatar slots,
 * the property rows centre their labels and the project tokens share a width.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const css = (name: string) => stripComments(readFileSync(path.join(root, "src/components/styles", `${name}.css`), "utf8"));
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

type Block = { prelude: string; body: string };

/** The blocks at the top nesting level of `text`: a prelude (selector or at-rule) and the text between its braces. */
function blocks(text: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = text.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        found.push({ prelude, body: text.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return found;
}

const TOUCH_MEDIA = "@media (pointer: coarse), (max-width: 480px)";
const PHONE_MEDIA = "@media (max-width: 480px)";

/** The declarations of the top-level rule whose selector is exactly `selector`. */
function topRule(text: string, selector: string): string {
  const found = blocks(text).find((block) => block.prelude.replace(/\s+/g, " ") === selector);
  if (!found) throw new Error(`no top-level rule for ${selector}`);
  return found.body;
}

/** The declarations of `selector` inside the media block `media`. */
function mediaRule(text: string, media: string, selector: string): string {
  const block = blocks(text).find((entry) => entry.prelude === media);
  if (!block) throw new Error(`no ${media} block`);
  return topRule(block.body, selector);
}

describe("intake search (P1)", () => {
  it("shrinks first so the filters stay on one row in the 360px list, and the bar still wraps where even that does not fit", () => {
    const rule = topRule(css("intake"), ".tessera-intake-search");
    expect(rule).toMatch(/flex:\s*1 1 auto/);
    expect(rule).toMatch(/min-width:\s*0/);
    expect(topRule(css("intake"), ".tessera-intake-filters.tessera-panel-bar--wraps > .tessera-panel-bar-start")).toMatch(/flex:\s*1 1 calc\(var\(--spacing-12\) \* 2\)/);
    const screen = source("src/components/intake/IntakeScreen.tsx");
    expect(screen).toMatch(/size="filters"\s*canWrap/);
  });

  it("makes Triage with assistant an icon button with a tooltip and keeps the text on New intake item", () => {
    const screen = source("src/components/intake/IntakeScreen.tsx");
    expect(screen).toMatch(/<IconButton[^>]*label="Triage with assistant"[^>]*tooltip="Triage with assistant"[^>]*icon=\{<SparkleIcon \/>\}/);
    expect(screen).toMatch(/<Button[^>]*label="New intake item"/);
  });
});

describe("side-panel lists (P3)", () => {
  const planning = css("planning");

  it("pulls the list rows out by their own 8px so the dots and text sit on the panel's 16px inset", () => {
    expect(topRule(planning, ".tessera-planning-panel-list")).toMatch(/margin-inline:\s*calc\(-1 \* var\(--spacing-2\)\)/);
    for (const file of ["ProgressPanel", "BreakdownTabs", "ModuleLinks"]) {
      expect(source(`src/components/planning/${file}.tsx`), file).toContain("tessera-planning-panel-list");
    }
  });

  it("pulls the breakdown tab strip in by a tab's 12px padding", () => {
    expect(topRule(planning, ".tessera-planning-breakdown-tabs")).toMatch(/margin-inline-start:\s*calc\(-1 \* var\(--spacing-3\)\)/);
    expect(source("src/components/planning/BreakdownTabs.tsx")).toContain('className="tessera-planning-breakdown-tabs"');
  });
});

describe("planning touch targets (P12, decision 14)", () => {
  const planning = css("planning");

  it("leaves the calendar button of a side-panel date input and the trigger of an sm selector at their drawn size (the hit area is shell.css's)", () => {
    const touch = blocks(planning).filter((entry) => entry.prelude === TOUCH_MEDIA).map((entry) => entry.body).join("\n");
    expect(touch).not.toMatch(/astryx-date-input/);
    expect(touch).not.toMatch(/role="combobox"/);
  });

  it("sets no 44px size outside the touch media blocks", () => {
    let outside = planning;
    for (const block of blocks(planning).filter((entry) => entry.prelude === TOUCH_MEDIA)) outside = outside.replace(block.body, "");
    expect(outside).not.toMatch(/--spacing-11/);
  });

  it("leaves the workspace sort selector at its drawn size and spaces the wrapped header rows 12px apart", () => {
    const workspace = css("workspace-views");
    expect(workspace).not.toMatch(/tessera-workspace-views-sort/);
    expect(mediaRule(workspace, TOUCH_MEDIA, ".tessera-workspace-views-bar.tessera-panel-bar--wraps > .tessera-panel-bar-end")).toMatch(/row-gap:\s*var\(--spacing-3\)/);
  });
});

describe("phone rows (P7, P8)", () => {
  it("drops the cycle row's 96px bar at 480px and narrower, keeping the count and a 12px gap", () => {
    const planning = css("planning");
    expect(mediaRule(planning, PHONE_MEDIA, ".tessera-planning-cycle-bar")).toMatch(/display:\s*none/);
    expect(mediaRule(planning, PHONE_MEDIA, ".tessera-planning-row-end")).toMatch(/margin-inline-start:\s*var\(--spacing-3\)/);
  });

  it("gives the module row's lead and members fixed slots, shrunk to content on a phone, and starts the wrapped line on the name's inset", () => {
    const modules = css("modules");
    expect(topRule(modules, ".tessera-modules-row-lead")).toMatch(/inline-size:\s*var\(--spacing-6\)/);
    expect(topRule(modules, ".tessera-modules-row-members")).toMatch(/inline-size:\s*calc\(var\(--spacing-6\) \* 4\)/);
    expect(mediaRule(modules, PHONE_MEDIA, ".tessera-modules-row-lead, .tessera-modules-row-members")).toMatch(/inline-size:\s*auto/);
    expect(mediaRule(modules, PHONE_MEDIA, ".tessera-modules-row > :has(> .tessera-modules-row-end)")).toMatch(/margin-inline-start:\s*var\(--spacing-4\)/);
  });
});

describe("module property rows (P2)", () => {
  it("centres a label against its control instead of aligning text baselines", () => {
    expect(topRule(css("modules"), ".tessera-modules-props dl")).toMatch(/align-items:\s*center/);
  });

  it("renders Lead and Members at size sm (28px) like the date inputs", () => {
    expect(source("src/components/planning/LeadControl.tsx")).toMatch(/size=\{compact \? "sm" : "md"\}/);
    expect(source("src/components/planning/ModuleSidePanel.tsx")).toMatch(/<AssigneeControl compact label="Members"/);
  });
});

describe("project rows and the New project dialog (P9, P14)", () => {
  const archives = css("archives");

  it("gives every project row's identifier token one minimum width, so the titles start at one x", () => {
    const rule = topRule(archives, ".tessera-project-row-token");
    expect(rule).toMatch(/min-inline-size:\s*calc\(var\(--spacing-12\) \+ var\(--spacing-4\)\)/);
    expect(rule).toMatch(/justify-content:\s*flex-start/);
    expect(source("src/app/(tessera)/projects/page.tsx")).toContain("tessera-project-row-token");
    expect(source("src/components/planning/ArchivedProjects.tsx")).toContain("tessera-project-row-token");
  });

  it("centres the KEY token in a control-high slot and keeps the footer gap at 8px", () => {
    expect(topRule(archives, ".tessera-project-key-slot")).toMatch(/min-block-size:\s*var\(--size-element-md\)/);
    const dialog = source("src/components/projects/CreateProjectDialog.tsx");
    expect(dialog).toContain('className="tessera-project-key-slot"');
    expect(dialog).toMatch(/<LayoutFooter>\s*<HStack gap=\{2\} hAlign="end">/);
  });
});

describe("small fixes read from the sources (P4, P10, P11)", () => {
  it("keeps the active cycles page on the 16px gutter, like the cycles summary card", () => {
    const screen = source("src/components/planning/ActiveCyclesScreen.tsx");
    expect(screen).toContain("<VStack gap={6} padding={4}>");
    expect(screen).not.toContain("padding={6}");
  });

  it("passes the cycle and module menu icons as components, so Astryx sizes them to the 16px icon box", () => {
    for (const file of ["CycleMenu", "ModuleMenu"]) {
      const text = source(`src/components/planning/${file}.tsx`);
      expect(text, file).toMatch(/const ICONS: Record<\w+, typeof PencilIcon> = \{\s*edit: PencilIcon,/);
      expect(text, file).not.toMatch(/: <\w+Icon \/>,/);
    }
  });

  it("gives Snooze and Unsnooze a clock icon like the other intake actions", () => {
    const text = source("src/components/intake/IntakeDetail.tsx");
    expect(text).toMatch(/label="Snooze…" icon=\{<ClockIcon \/>\}/);
    expect(text).toMatch(/label="Unsnooze" icon=\{<ClockIcon \/>\}/);
  });
});

describe("list rows on the 16px gutter (P6, P5)", () => {
  it("insets the drafts and intake lists by a ListItem's own 8px, so the icon starts on the gutter", () => {
    for (const file of ["src/components/drafts/DraftsScreen.tsx", "src/components/intake/IntakeScreen.tsx", "src/components/views/WorkspaceViewsScreen.tsx"]) {
      expect(source(file), file).toContain("paddingInline={2}");
    }
  });

  it("keeps the intake tabs on the generic header tab-strip rules (no screen class), the strip first in the start group", () => {
    const screen = source("src/components/intake/IntakeScreen.tsx");
    expect(screen).toMatch(/<PanelBar\s+canWrap\s+start=\{\s*<TabList/);
  });
});
