/**
 * Visual-audit fixes of the pages lane, read from the stylesheets (jsdom runs
 * no layout; the live measurements are the visual audit's pages/measure.mjs):
 * the outline's gutter and top line, the title's size and pencil, the tree's
 * touch hit areas (decision 14), the editor's heading scale, task checkboxes,
 * drag handle, read-only colour and compact comment height, and the lock pill.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(path.join(process.cwd(), "src/components/styles", name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pages = read("pages.css");
const editor = read("editor.css");
const lock = read("lock-control.css");
const shell = read("shell.css");

/** Body of the first rule whose selector (the text before `{`) equals `selector`, from `source`. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

/** The text of the `@media (pointer: coarse), (max-width: 480px)` blocks of `source`. */
function touchBlock(source: string): string {
  const head = "@media (pointer: coarse), (max-width: 480px) {";
  const blocks: string[] = [];
  let at = source.indexOf(head);
  while (at >= 0) {
    let depth = 0;
    let end = at + head.length - 1;
    for (let i = end; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    blocks.push(source.slice(at, end + 1));
    at = source.indexOf(head, end);
  }
  expect(blocks.length).toBeGreaterThan(0);
  return blocks.join("\n");
}

describe("page frame and outline", () => {
  it("keeps a 16px gutter right of the outline without moving the 1136px switch", () => {
    expect(pages).toContain("@container (min-width: 1136px)");
    expect(pages).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 960px minmax\(160px, 240px\) minmax\(var\(--spacing-4\), 1fr\)/);
  });

  it("aligns the outline's top with the column's first element", () => {
    const outline = rule(pages, '.tessera-page-frame[data-outline="open"] > .tessera-page-outline');
    expect(outline).toMatch(/inset-block-start:\s*var\(--spacing-5\)/);
    expect(outline).toMatch(/margin-block-start:\s*var\(--spacing-5\)/);
  });

  it("indents outline entries by heading level and layers the hover on a pressed toggle", () => {
    expect(rule(pages, '.tessera-page-outline .astryx-outline-item[data-level="2"]')).toMatch(/padding-inline-start:\s*calc\(var\(--spacing-3\) \+ var\(--spacing-2\)\)/);
    expect(rule(pages, '.tessera-page-outline .astryx-outline-item[data-level="3"]')).toMatch(/padding-inline-start:\s*calc\(var\(--spacing-3\) \+ var\(--spacing-4\)\)/);
    expect(rule(pages, '.tessera-page-outline-toggle[aria-pressed="true"]:hover')).toContain("background-image");
  });
});

describe("page title", () => {
  it("is larger than the body's h1 and centres its pencil on the first line", () => {
    const title = rule(pages, ".tessera-page-title");
    expect(title).toContain("var(--text-display-3-size)");
    expect(title).toContain("var(--text-display-3-leading)");
    const edit = rule(pages, ".tessera-page-title-edit");
    expect(edit).toMatch(/margin-block-start:\s*calc\(\(var\(--text-display-3-size\) \* var\(--text-display-3-leading\) - var\(--tessera-title-edit-size\)\) \/ 2\)/);
    expect(touchBlock(pages)).toMatch(/\.tessera-page-title-edit\s*\{\s*--tessera-title-edit-size:\s*var\(--spacing-11\)/);
  });
});

describe("page tree", () => {
  it("shows the grip when the row's list item has keyboard focus", () => {
    expect(pages).toContain('li[role="treeitem"]:focus-visible > div > .tessera-page-row--draggable .tessera-row-grip');
  });

  it("gives the chevron and link a 44px touch target, leaves the menu and meta controls to the theme's hit area, and keeps the chevron clear of the grip", () => {
    const touch = touchBlock(pages);
    expect(touch).toMatch(/\.tessera-page-row\s*\{\s*min-block-size:\s*var\(--spacing-11\)/);
    const chevron = /\.tessera-page-row \.astryx-tree-list-chevron\s*\{([^}]*)\}/.exec(touch)?.[1] ?? "";
    expect(chevron).toContain("box-sizing: content-box");
    expect(chevron).toMatch(/padding-block:\s*calc\(var\(--spacing-3\) \+ var\(--spacing-1\) \/ 2\)/);
    // 12px (to the row's left edge) + 16px glyph + 16px = 44px; the grip starts after it.
    expect(chevron).toMatch(/padding-inline:\s*var\(--spacing-3\) var\(--spacing-4\)/);
    expect(touch).toMatch(/\.tessera-page-row-lead--branches\s*\{\s*margin-inline-start:\s*calc\(var\(--spacing-6\) \+ var\(--spacing-0-5\)\)/);
    expect(touch).toMatch(/\.tessera-page-row > a\s*\{[^}]*padding-block:\s*var\(--spacing-3\)/);
    // The row menu, the access token, the Labels picker and the search field keep their drawn size: the theme's pseudo-element is their 44px hit area, so no margin gives room back and no combobox is a 44px block.
    expect(touch).not.toMatch(/\.tessera-page-row-end \.astryx-button/);
    expect(touch).not.toMatch(/\.tessera-page-meta-control \[role="combobox"\]/);
    expect(touch).not.toMatch(/\.tessera-pages-search/);
    expect(touch).toMatch(/\.tessera-page-meta-control > button\s*\{\s*align-self:\s*stretch/);
    expect(touch).toMatch(/\.tessera-page-outline \.astryx-outline-item\s*\{\s*min-block-size:\s*var\(--spacing-11\)/);
  });

  it("keeps every 44px box of a tree row inside a square row so no corner is clipped (wiki at 375)", () => {
    const touch = touchBlock(pages);
    // The row clips to its rounded corners: square, the corners of a box that reaches the row's edge still hit it.
    expect(touch).toMatch(/\.tessera-page-row\s*\{[^}]*border-radius:\s*0;/);
    expect(/\.tessera-page-row \.astryx-tree-list-chevron\s*\{([^}]*)\}/.exec(touch)?.[1] ?? "").toMatch(/border-radius:\s*0;/);
    // A flat tree's grip box (14px past its 16px icon each side) would start 6px left of the row: the lead steps in by 6px.
    expect(touch).toMatch(/\.tessera-page-row-lead--grip\s*\{\s*margin-inline-start:\s*var\(--spacing-1-5\)/);
    expect(touch.indexOf(".tessera-page-row-lead--grip")).toBeLessThan(touch.indexOf(".tessera-page-row-lead--branches"));
  });

  it("never blocks touch panning outside the grip", () => {
    expect(pages).not.toContain("touch-action");
  });
});

describe("editor", () => {
  it("steps the body headings on the theme scale below the page title", () => {
    expect(rule(editor, ".tessera-editor-content h1")).toContain("var(--text-heading-1-size)");
    expect(rule(editor, ".tessera-editor-content h2")).toContain("var(--text-heading-2-size)");
    expect(rule(editor, ".tessera-editor-content h3")).toContain("var(--text-heading-3-size)");
    expect(rule(editor, ".tessera-editor-content > :first-child")).toMatch(/margin-block-start:\s*0/);
  });

  it("keeps one body colour in a read-only editor", () => {
    expect(editor).not.toMatch(/(?:^|[\s,}])\.tessera-editor--readonly \.tessera-editor-content\s*\{/);
  });

  it("drops the composer height and the toolbar row of a read-only compact editor, except in source mode", () => {
    expect(rule(editor, ".tessera-editor--compact.tessera-editor--readonly .tessera-editor-content")).toMatch(/min-height:\s*auto/);
    expect(rule(editor, ".tessera-editor--compact.tessera-editor--readonly:not(.tessera-editor--source) .tessera-editor-toolbar")).toMatch(/display:\s*none/);
    expect(rule(editor, ".tessera-editor--compact .tessera-editor-content")).toMatch(/min-height:\s*120px/);
  });

  it("draws task checkboxes 16px in the accent colour with a 24px (44px on touch) label as the hit area", () => {
    const input = rule(editor, '.tessera-editor-content ul[data-type="taskList"] > li > label input');
    expect(input).toMatch(/accent-color:\s*var\(--color-accent\)/);
    expect(input).toMatch(/inline-size:\s*var\(--spacing-4\)/);
    const label = rule(editor, '.tessera-editor-content ul[data-type="taskList"] > li > label');
    expect(label).toMatch(/--tessera-task-hit:\s*var\(--spacing-6\)/);
    expect(touchBlock(editor)).toMatch(/--tessera-task-hit:\s*var\(--spacing-11\)/);
  });

  it("keeps the 44px task labels from covering the next task on touch (task at least as tall as its label)", () => {
    const touch = touchBlock(editor);
    expect(touch).toMatch(/ul\[data-type="taskList"\] > li\s*\{\s*min-block-size:\s*var\(--spacing-11\)/);
    expect(touch).toMatch(/> li > label\s*\{[^}]*position:\s*relative/);
    // Desktop keeps the compact 22px task pitch: the min height lives in the touch block only.
    expect(rule(editor, '.tessera-editor-content ul[data-type="taskList"] > li')).not.toMatch(/min-block-size/);
  });

  it("makes a slash or mention option a 44px target on touch", () => {
    expect(touchBlock(editor)).toMatch(/\.tessera-editor-option\s*\{\s*min-block-size:\s*var\(--spacing-11\)/);
  });

  it("sizes the block drag handle at 20px inside the content's start padding", () => {
    const handle = rule(editor, ".tessera-editor-drag");
    expect(handle).toMatch(/width:\s*var\(--spacing-5\)/);
    expect(handle).toMatch(/height:\s*var\(--spacing-5\)/);
    expect(rule(editor, ".tessera-editor-content")).toMatch(/padding-inline:\s*var\(--spacing-8\) var\(--spacing-4\)/);
  });
});

describe("lock pill", () => {
  it("renders the locked label as a 24px pill with an accent tint", () => {
    const pill = rule(lock, ".tessera-lock-pill");
    expect(pill).toMatch(/block-size:\s*var\(--spacing-6\)/);
    expect(pill).toMatch(/padding-inline:\s*var\(--spacing-2\)/);
    expect(pill).toMatch(/color-mix\(in srgb, var\(--color-accent\) 20%, transparent\)/);
    expect(pill).toMatch(/color:\s*var\(--color-text-primary\)/);
  });
});

describe("pages sub-header", () => {
  it("docks the tab strip on the hairline below 600px (S7, Pg14): tabsBelow with the end group on the first row", () => {
    const screen = readFileSync(path.join(process.cwd(), "src/components/pages/PagesScreen.tsx"), "utf8");
    // tabsBelow is not combined with canWrap (PanelHeader.tsx): the wrap rules would otherwise share the bar with the phone grid.
    expect(screen).toMatch(/<PanelBar size="subheader" tabsBelow className="tessera-pages-bar"/);
    expect(screen).not.toMatch(/<PanelBar[^>]*canWrap[^>]*tabsBelow/);
    // The generic grid and the 44px tabs come from shell.css; pages.css only drops the empty title column.
    expect(shell).toContain(".tessera-panel-bar.tessera-panel-bar--tabs-below");
    const bar = /\.tessera-panel-bar\.tessera-panel-bar--tabs-below\.tessera-pages-bar\s*\{([^}]*)\}/.exec(pages)?.[1] ?? "";
    expect(bar).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(bar).toMatch(/"end"\s+"tabs"/);
  });
});

describe("pages lane leftovers (visual audit)", () => {
  it("keeps the bubble link placeholder short enough for the 262px input and moves the hint to the label", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/editor/MarkdownEditor.tsx"), "utf8");
    const placeholder = /placeholder="(https:[^"]*)"/.exec(source)?.[1] ?? "";
    expect(placeholder).not.toBe("");
    expect(placeholder.length).toBeLessThanOrEqual(30);
    expect(source).toContain('label="Link URL (empty removes the link)"');
  });

  it("holds a version's label, author and time in one row that is highlighted as a whole", () => {
    const dialog = readFileSync(path.join(process.cwd(), "src/components/history/VersionHistoryDialog.tsx"), "utf8");
    expect(dialog).toContain("tessera-history-row-meta");
    expect(dialog).toMatch(/<Timestamp value=\{row\.created_at\} \/>/);
    const history = read("history.css");
    expect(rule(history, ".tessera-history-row[data-selected]")).toMatch(/background:\s*var\(--color-background-muted\)/);
    expect(rule(history, ".tessera-history-row-button")).toMatch(/justify-content:\s*flex-start/);
  });
});
