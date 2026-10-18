import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/tessera/core/csv";

describe("csv", () => {
  it("quotes, guards formulas, and writes a BOM with CRLF", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("=SUM(1,2)")).toBe("\"'=SUM(1,2)\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(null)).toBe("");
    const csv = toCsv(["Name", "Note"], [["Ada", "line\n2"], ["=cmd", null]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("\"line\n2\"");
  });
});
