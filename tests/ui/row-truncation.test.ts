/**
 * Work-item rows cut their title and their state, priority, assignee and
 * group-marker labels to one line with CSS, not with Astryx Text maxLines:
 * Astryx 0.6.8 runs useTruncation for every Text with maxLines > 0 (even with
 * hasTruncateTooltip={false}) and measures it in its ref callback, one forced
 * layout per Text, thousands in a long list. The same goes for the table's Name
 * and Project cells and for the gantt (work items and modules): band labels, row
 * names and bar labels. Where the old Text showed the full text in a tooltip
 * when cut (row title, table cells, gantt labels), OneLineText still does, but
 * measures on hover only (tests/ui/one-line-text.test.ts). Read from the
 * sources (jsdom runs no CSS layout), like tests/ui/home-touch-css.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const stripCss = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const ROW_FILES = [
  "src/components/work-items/ListLayout.tsx",
  "src/components/work-items/TableLayout.tsx",
  "src/components/work-items/VirtualTable.tsx",
  "src/components/work-items/table-cells.tsx",
  "src/components/work-items/GanttLayout.tsx",
  "src/components/work-items/GanttRows.tsx",
  "src/components/planning/ModulesTimeline.tsx",
  "src/components/work-items/properties/StateControl.tsx",
  "src/components/work-items/properties/PriorityControl.tsx",
  "src/components/work-items/properties/AssigneeControl.tsx",
  "src/components/work-items/properties/DateControl.tsx",
];

/** The declarations of the top-level rule whose selector list is exactly `selectors` (whitespace-insensitive). */
function ruleFor(source: string, selectors: string[]): string {
  const want = selectors.join(",");
  const found = [...source.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{([^}]*)\}/g)].find((match) => (match[1] ?? "").replace(/\s+/g, "") === want);
  if (!found) throw new Error(`no top-level rule for ${selectors.join(", ")}`);
  return found[2] ?? "";
}

/** The four declarations of Astryx's Text singleLine style and nothing else, tokens-free. */
function expectSingleLine(body: string) {
  expect(body).toMatch(/display:\s*block;/);
  expect(body).toMatch(/overflow:\s*hidden;/);
  expect(body).toMatch(/text-overflow:\s*ellipsis;/);
  expect(body).toMatch(/white-space:\s*nowrap;/);
  expect(body.split(";").filter((part) => part.trim() !== "")).toHaveLength(4);
  expect(body).not.toMatch(/px|#|var\(/);
}

describe("row text truncation", () => {
  it.each(ROW_FILES)("%s uses no Text maxLines", (file) => {
    expect(read(file)).not.toMatch(/maxLines/);
  });

  it("puts the one-line class on the row title and on every label Text", () => {
    const list = read("src/components/work-items/ListLayout.tsx");
    expect(list).toMatch(/<OneLineText className="tessera-wi-title" weight="medium">/);
    // GroupMarker: the "none" group and the plain-name fallback.
    expect(list.match(/className="tessera-wi-label-text"/g)).toHaveLength(2);
    for (const file of ["StateControl", "PriorityControl", "AssigneeControl"]) {
      expect(read(`src/components/work-items/properties/${file}.tsx`)).toMatch(/<Text type="inherit" className="tessera-wi-label-text">/);
    }
  });

  it("cuts the table's Name and Project cells with OneLineText, inside the Table's own textOverflow=\"truncate\"", () => {
    // The Table element lives in VirtualTable.tsx and the memo cells in table-cells.tsx (virtual table windows).
    expect(read("src/components/work-items/VirtualTable.tsx")).toMatch(/<Table<TableRow>[^>]*textOverflow="truncate"/);
    const cells = read("src/components/work-items/table-cells.tsx");
    expect(cells).toMatch(/<OneLineText className="tessera-wi-cell-text" weight="medium">\s*\{item\.name\}/);
    expect(cells).toMatch(/<OneLineText className="tessera-wi-cell-text">\{projectName\.get\(item\.project_id\) \?\? ""\}<\/OneLineText>/);
    // Both cells render inside the Name and Project columns.
    expect(cells).toMatch(/key: "name"[^\n]*renderCell: \(row\) => <NameCell item=\{row\.item\} \/>/);
    expect(cells).toMatch(/key: "project"[^\n]*renderCell: \(row\) => <ProjectCell item=\{row\.item\} projectName=\{projectName\} \/>/);
  });

  it("cuts the gantt's band labels, row names and bar labels with OneLineText", () => {
    // The work item gantt's rows (GanttRow) live in GanttRows.tsx; its head stays in GanttLayout.tsx.
    const sources = [
      { file: "work items gantt", source: read("src/components/work-items/GanttLayout.tsx") + read("src/components/work-items/GanttRows.tsx") },
      { file: "modules timeline", source: read("src/components/planning/ModulesTimeline.tsx") },
    ];
    for (const { file, source } of sources) {
      expect(source, file).toMatch(/<OneLineText type="supporting" className="tessera-gantt-month-label">/);
      expect(source, file).toMatch(/<OneLineText className="tessera-gantt-name">/);
      expect(source, file).toMatch(/<OneLineText type="supporting" className="tessera-gantt-bar-label">/);
    }
    expect(read("src/components/work-items/GanttLayout.tsx")).toMatch(/<OneLineText type="supporting" className="tessera-gantt-month-label">/);
    const rows = read("src/components/work-items/GanttRows.tsx");
    expect(rows).toMatch(/<OneLineText className="tessera-gantt-name">/);
    expect(rows).toMatch(/<OneLineText type="supporting" className="tessera-gantt-bar-label">/);
  });

  it("gives the list and table classes the four declarations of Astryx's Text singleLine style, tokens-free", () => {
    expectSingleLine(ruleFor(stripCss(read("src/components/styles/work-items.css")), [".tessera-wi-title", ".tessera-wi-cell-text", ".tessera-wi-label-text"]));
  });

  it("gives the gantt label classes the same four declarations, before the bar label's container query", () => {
    const gantt = stripCss(read("src/components/styles/gantt.css"));
    expectSingleLine(ruleFor(gantt, [".tessera-gantt-month-label", ".tessera-gantt-name", ".tessera-gantt-bar-label"]));
    // Same specificity: the container query's `display: none` must come later to hide the bar label in a short bar.
    const shared = gantt.indexOf(".tessera-gantt-bar-label {\n  display: block;");
    expect(shared).toBeGreaterThan(-1);
    expect(gantt.indexOf("@container tessera-bar")).toBeGreaterThan(shared);
  });
});
