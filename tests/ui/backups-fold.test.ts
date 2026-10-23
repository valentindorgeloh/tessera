/**
 * The backups table folds below its column floors like exports and webhook
 * deliveries (fix round 2026-10-23, settings-home item 1; decision 14: no hidden
 * sideways swipe). It has no CSS of its own: the fold is column definitions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("backups table fold", () => {
  const widths = read("src/components/workspace-settings/table-widths.ts");
  const source = read("src/components/backups/BackupsScreen.tsx");
  const floor = (name: string) => Number(new RegExp(`${name} = (?:pixel\\(|proportional\\(1, \\{ minWidth: )(\\d+)`).exec(widths)?.[1]);

  it("BACKUPS_FULL_WIDTH is the sum of the full column floors", () => {
    const full = floor("FILE_NAME_COLUMN") + floor("TOKEN_COLUMN") + floor("SHORT_COLUMN") + floor("TIME_COLUMN") + floor("SHORT_COLUMN");
    expect(Number(/BACKUPS_FULL_WIDTH = (\d+)/.exec(widths)?.[1])).toBe(full);
  });

  it("the folded floors fit a 325px phone column", () => {
    expect(floor("FILE_NAME_COLUMN_FOLDED") + floor("TOKEN_COLUMN")).toBeLessThanOrEqual(325);
  });

  it("measures the settings body and swaps the column sets", () => {
    expect(source).toContain("useNarrowContainer(BACKUPS_FULL_WIDTH)");
    expect(source).toContain("ref={bodyRef}");
    expect(source).toContain("[foldedFileColumn, kindColumn]");
    expect(source).toContain("[fileColumn, kindColumn, sizeColumn, createdColumn, checkColumn]");
  });

  it("folds size, check and age under the file name", () => {
    const folded = source.slice(source.indexOf("const foldedFileColumn"), source.indexOf("const kindColumn"));
    expect(folded).toContain("row.size");
    expect(folded).toContain("row.check");
    expect(folded).toContain("<RelativeTime");
  });
});
