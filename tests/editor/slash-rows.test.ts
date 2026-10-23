/**
 * The `/` menu rows (docs/contracts/editor.md "Suggestion sources"): every block
 * command has a glyph and none carries a description line, so the rows share one
 * height; the Table row's text is a hint (its tooltip).
 */
import { describe, expect, it } from "vitest";
import { BLOCK_ICONS, blockRows } from "@/components/editor/mentions";

describe("slash menu rows", () => {
  const rows = blockRows("");

  it("gives every block command an icon", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) expect(BLOCK_ICONS[row.id], row.id).toBeDefined();
  });

  it("keeps one line per row: no description, the Table text is a hint", () => {
    for (const row of rows) expect(row.description, row.id).toBeUndefined();
    expect(rows.find((row) => row.id === "table")?.hint).toBe("3 by 3 with a header row");
  });
});
