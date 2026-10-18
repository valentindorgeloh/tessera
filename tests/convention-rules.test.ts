import { describe, expect, it } from "vitest";
import { countLines, evaluateFileBudget, parseDecisionNumbers, unknownDecisionRefs } from "../scripts/convention-rules";

const PLAN = [
  "## Context",
  "| 99 | **Not a decision row** |",
  "## Resolved design decisions",
  "| # | Decision |",
  "|---|---|",
  "| 1 | **Workspace** |",
  "| 23 | **Remembered display settings** |",
  "| U6 | **Licence gate** |",
  "## 1. Scope map",
  "| 7 | **Outside the section** |",
].join("\n");

describe("decision references", () => {
  const known = parseDecisionNumbers(PLAN);

  it("reads the numbers from the decisions tables only", () => {
    expect([...known].sort()).toEqual(["1", "23", "U6"]);
  });

  it("accepts cited numbers that exist, in line and block comments", () => {
    const lines = ["// see decision 23", "/** Licence gate (plan decision U6). */", "/*", " * decision 1 and Decision u6", " */"];
    expect(unknownDecisionRefs(lines, known)).toEqual([]);
  });

  it("reads every number of a list citation", () => {
    const lines = ["// decisions 1, 23 and 40", "// decisions 106, 113"];
    expect(unknownDecisionRefs(lines, known)).toEqual([
      { line: 1, number: "40" },
      { line: 2, number: "106" },
      { line: 2, number: "113" },
    ]);
  });

  it("reports unknown numbers with their line, and ignores string literals", () => {
    const lines = ["const a = 'decision 5';", "// decision 5 is missing", "/*", " * decision U9 too", " */", "const b = 1; // decision 23 ok, decision 40 not"];
    expect(unknownDecisionRefs(lines, known)).toEqual([
      { line: 2, number: "5" },
      { line: 4, number: "U9" },
      { line: 6, number: "40" },
    ]);
  });
});

describe("file budget ratchet", () => {
  const exempt = new Set(["big-exempt.tsx"]);
  const budget = { "old.ts": 900, "shrunk.ts": 800 };

  it("passes at or below the recorded counts and lists exempt files", () => {
    const result = evaluateFileBudget({ "old.ts": 900, "small.ts": 599, "big-exempt.tsx": 1100, "shrunk.ts": 800 }, budget, exempt);
    expect(result.failures).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.exempt).toEqual(["big-exempt.tsx"]);
  });

  it("fails when a listed file grows or an unlisted file passes 600 lines", () => {
    const result = evaluateFileBudget({ "old.ts": 901, "new-big.ts": 601, "edge.ts": 600 }, budget, exempt);
    expect(result.failures.map((f) => f.file)).toEqual(["new-big.ts", "old.ts"]);
  });

  it("notes a shrunk file without failing", () => {
    const result = evaluateFileBudget({ "old.ts": 850, "shrunk.ts": 500 }, budget, exempt);
    expect(result.failures).toEqual([]);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toContain("old.ts shrank to 850");
    expect(result.notes[1]).toContain("remove it from");
  });

  it("counts lines like wc -l", () => {
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("")).toBe(0);
  });
});
