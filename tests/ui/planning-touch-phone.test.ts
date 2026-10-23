// @vitest-environment jsdom
/**
 * Visual audit, planning lane, second round (decision 14): the row hit area,
 * the touch fixes in the planning dialogs, the intake split below 1024px and
 * the small leftovers (view menu icons, module bar). jsdom runs no CSS layout,
 * so rules are read from the stylesheet text; the intake screen is rendered on
 * the server (renderToString) with its actions, the router and the assistant
 * mocked.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { IntakeCounts, IntakeItemView } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/ai/AssistantProvider", () => ({ useAssistant: () => ({ status: null, ask: vi.fn() }) }));
vi.mock("@/components/work-items/CreateWorkItemDialog", () => ({ CreateWorkItemDialog: () => null }));

const { IntakeScreen } = await import("@/components/intake/IntakeScreen");

const root = process.cwd();
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const css = (name: string) => strip(readFileSync(path.join(root, "src/components/styles", `${name}.css`), "utf8"));
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

type Block = { prelude: string; body: string };
function blocks(text: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) {
        prelude = text.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        found.push({ prelude, body: text.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return found;
}
const norm = (value: string) => value.replace(/\s+/g, " ");
const TOUCH = "@media (pointer: coarse), (max-width: 480px)";
const NARROW = "@media (max-width: 1023px)";

/** The declarations of `selector` inside the media block `media` of a stylesheet. */
function inMedia(text: string, media: string, selector: string): string {
  const bodies = blocks(text).filter((block) => block.prelude === media);
  for (const block of bodies) {
    const found = blocks(block.body).find((inner) => norm(inner.prelude) === selector);
    if (found) return found.body;
  }
  throw new Error(`no ${selector} in ${media}`);
}
function top(text: string, selector: string): string {
  const found = blocks(text).find((block) => norm(block.prelude) === selector);
  if (!found) throw new Error(`no top-level ${selector}`);
  return found.body;
}

describe("row hit area (P12)", () => {
  const planning = css("planning");

  it("reaches the row's padding with a pseudo-element, only under touch, and changes no size", () => {
    expect(inMedia(planning, TOUCH, ".tessera-row-hit > a::before, .tessera-row-hit > button::before")).toMatch(/inset-block:\s*calc\(-1 \* var\(--tessera-row-pad\)\)/);
    expect(inMedia(planning, TOUCH, ".tessera-row-hit > a, .tessera-row-hit > button")).toMatch(/position:\s*relative/);
    expect(inMedia(planning, TOUCH, ".tessera-row-hit")).toMatch(/--tessera-row-pad:\s*var\(--spacing-2\)/);
    expect(inMedia(planning, TOUCH, '.tessera-row-hit[data-density="compact"]')).toMatch(/--tessera-row-pad:\s*var\(--spacing-1\)/);
    // Nothing of the rule sits outside the touch block: a mouse on a wide screen is unchanged.
    expect(planning.replace(/@media \(pointer: coarse\), \(max-width: 480px\) \{[\s\S]*?\n\}\n/g, "")).not.toContain("tessera-row-hit");
  });

  it("is on every planning, views, intake, drafts and projects row", () => {
    const files = [
      "src/components/planning/CycleRow.tsx",
      "src/components/planning/ModuleRow.tsx",
      "src/components/planning/ArchivedCycles.tsx",
      "src/components/planning/ArchivedModules.tsx",
      "src/components/planning/ArchivedProjects.tsx",
      "src/components/planning/ArchivedWorkItems.tsx",
      "src/components/views/ViewRow.tsx",
      "src/components/views/WorkspaceViewsScreen.tsx",
      "src/components/intake/IntakeScreen.tsx",
      "src/components/intake/DuplicateDialog.tsx",
      "src/components/drafts/DraftsScreen.tsx",
      "src/app/(tessera)/projects/page.tsx",
    ];
    for (const file of files) expect(source(file), file).toContain("tessera-row-hit");
  });
});

describe("touch fixes in the planning dialogs (P12)", () => {
  it("gives the cycle date range's trigger the 44px box and its calendar icon a DateInput-style area", () => {
    const planning = css("planning");
    const trigger = inMedia(planning, TOUCH, ".tessera-cycle-dates > button");
    expect(trigger).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(trigger).toMatch(/margin-block:\s*calc\(\(var\(--size-element-md\) - var\(--spacing-11\)\) \/ 2\)/);
    expect(inMedia(planning, TOUCH, '.tessera-cycle-dates > button[aria-label="Open calendar"]::before')).toMatch(/inset-inline:\s*calc\(-1 \* var\(--spacing-5\)\) calc\(-1 \* var\(--spacing-2\)\)/);
    expect(source("src/components/planning/CycleDialog.tsx")).toContain('className="tessera-cycle-dates"');
  });

  it("keeps 8px under the last field of a scrolling dialog form, so the hit area is not clipped", () => {
    expect(inMedia(css("planning"), TOUCH, ".tessera-dialog-form")).toMatch(/padding-block-end:\s*var\(--spacing-2\)/);
    for (const file of ["src/components/planning/CycleDialog.tsx", "src/components/views/ViewDialog.tsx", "src/components/projects/CreateProjectDialog.tsx"]) {
      expect(source(file), file).toContain('<FormLayout className="tessera-dialog-form">');
    }
  });

  it("makes each module dialog property row 44px, so neighbouring areas tile; the side panel keeps its rows", () => {
    const modules = css("modules");
    expect(inMedia(modules, TOUCH, ".tessera-modules-props--dialog dl")).toMatch(/row-gap:\s*0/);
    expect(inMedia(modules, TOUCH, ".tessera-modules-props--dialog dd")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(source("src/components/planning/ModuleDialog.tsx")).toContain("tessera-modules-props--dialog");
    expect(source("src/components/planning/ModuleSidePanel.tsx")).not.toContain("tessera-modules-props--dialog");
  });

  it("wraps the draft dialog footer so the three labels fit a phone, with a 12px row gap under touch", () => {
    expect(source("src/components/drafts/DraftDialog.tsx")).toMatch(/<HStack gap=\{2\} hAlign="end" wrap="wrap" className="tessera-drafts-footer">/);
    expect(inMedia(css("drafts"), TOUCH, ".tessera-drafts-footer")).toMatch(/row-gap:\s*var\(--spacing-3\)/);
  });

  it("keeps 8px above and below the wrapped intake filters row under touch", () => {
    expect(inMedia(css("intake"), TOUCH, ".tessera-intake-filters.tessera-panel-bar--wraps")).toMatch(/padding-block:\s*var\(--spacing-2\)/);
  });
});

describe("intake below 1024px (the detail was 0px wide on a phone)", () => {
  const intake = css("intake");

  it("fills the panel with the list, hides the empty detail and shows the item instead of the list", () => {
    expect(inMedia(intake, NARROW, ".tessera-intake .tessera-intake-list")).toMatch(/inline-size:\s*100%/);
    expect(inMedia(intake, NARROW, ".tessera-intake:not(.tessera-intake--item) .tessera-intake-detail-pane")).toMatch(/display:\s*none/);
    expect(inMedia(intake, NARROW, ".tessera-intake--item .tessera-intake-list")).toMatch(/display:\s*none/);
    expect(inMedia(intake, NARROW, ".tessera-intake .tessera-intake-back")).toMatch(/display:\s*flex/);
    expect(top(intake, ".tessera-intake .tessera-intake-back")).toMatch(/display:\s*none/);
  });

  it("wraps the item's action row", () => {
    expect(top(intake, ".tessera-intake-actions")).toMatch(/flex-wrap:\s*wrap/);
    expect(source("src/components/intake/IntakeDetail.tsx")).toContain('className="tessera-intake-actions"');
  });

  const counts: IntakeCounts = { open: 1, snoozed: 0, closed: 0 };
  const item = {
    id: "i1",
    work_item_id: "w1",
    key: "WEB-1",
    name: "Crash report",
    priority: "high",
    source: "mcp",
    status: "pending",
    snoozed_till: null,
    duplicate_to: null,
    created_by: { name: "Ada" },
    created_at: "2026-10-22T10:00:00.000Z",
  } as unknown as IntakeItemView;

  function screen(itemId: string | null): HTMLElement {
    const container = document.createElement("div");
    const query = { tab: "open" as const, q: "", item: itemId };
    container.innerHTML = renderToString(createElement(IntakeScreen, { projectId: "p1", query, items: [item], counts }, itemId ? createElement("p", { className: "probe" }, "detail") : undefined));
    return container;
  }

  it("marks the layout and offers a Back link (to the list, keeping the tab) only while an item is open", () => {
    const closed = screen(null);
    expect(closed.querySelector(".tessera-intake--item")).toBeNull();
    expect(closed.querySelector(".tessera-intake-back")).toBeNull();

    const open = screen("w1");
    expect(open.querySelector(".tessera-intake.tessera-intake--item")).not.toBeNull();
    const back = open.querySelector(".tessera-intake-back a, .tessera-intake-back button");
    expect(back?.textContent).toContain("Back to intake");
    expect(back?.getAttribute("href") ?? "").toBe("/projects/p1/intake");
    expect(open.querySelector(".probe")).not.toBeNull();
  });
});

describe("small leftovers (P10, module row)", () => {
  it("passes every view menu icon as a component, so the menu sizes it to the 16px icon box like the cycle and module menus", () => {
    const text = source("src/components/views/ViewMenu.tsx");
    expect(text).not.toMatch(/icon: <\w+Icon \/>/);
    expect(text).toMatch(/icon: PencilIcon/);
    expect(text).toMatch(/icon: TrashIcon/);
    expect(source("src/components/planning/ModuleLinks.tsx")).not.toMatch(/icon: <\w+Icon \/>/);
  });

  it("keeps the module row's progress bar on a phone, 48px wide, instead of dropping it", () => {
    const modules = css("modules");
    expect(top(modules, ".tessera-modules-row-bar")).toMatch(/width:\s*96px/);
    const phone = inMedia(modules, "@media (max-width: 480px)", ".tessera-modules-row-bar");
    expect(phone).toMatch(/width:\s*var\(--spacing-12\)/);
    expect(phone).not.toMatch(/display:\s*none/);
    // The phone rule must come after the base rule, or the 96px one would win (same specificity).
    const raw = readFileSync(path.join(root, "src/components/styles/modules.css"), "utf8");
    expect(raw.indexOf(".tessera-modules-row-bar {\n  width: 96px")).toBeLessThan(raw.indexOf("width: var(--spacing-12)"));
  });
});
