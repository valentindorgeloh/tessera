import { describe, expect, it } from "vitest";
import {
  countLines,
  definedTokens,
  evaluateFileBudget,
  parseDecisionNumbers,
  stripComments,
  tokenUses,
  undefinedTokenUses,
  visibleOurTokens,
  unknownDecisionRefs,
} from "../scripts/convention-rules";

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

describe("css token safety", () => {
  const astryx = new Set(["--spacing-4", "--color-border", "--border-width"]);
  const check = (css: string, ours: string[] = []) => undefinedTokenUses(tokenUses(css, "css"), astryx, new Set(ours)).map((h) => `${h.line}:${h.name}`);

  it("passes tokens Astryx defines", () => {
    expect(check(".a { padding: var(--spacing-4); border: var(--border-width) solid var(--color-border); }")).toEqual([]);
  });

  it("fails a spacing step Astryx lacks (the gantt var(--spacing-16) bug) and an unknown colour", () => {
    expect(check(".a {\n  left: var(--spacing-16);\n  border-color: var(--color-border-tertiary);\n}")).toEqual(["2:--spacing-16", "3:--color-border-tertiary"]);
  });

  it("fails every guarded family when the name is undefined", () => {
    const css = [
      "--radius-huge",
      "--font-size-huge",
      "--size-huge",
      "--shadow-huge",
      "--duration-huge",
      "--ease-huge",
      "--z-modal",
      "--border-huge",
      "--line-height-huge",
      "--text-huge",
    ]
      .map((n) => `a { x: var(${n}); }`)
      .join("\n");
    expect(check(css)).toHaveLength(10);
  });

  it("accepts our own definitions in an Astryx family and ignores other families", () => {
    expect(check(".a { color: var(--color-brand); width: var(--other-thing); }", ["--color-brand"])).toEqual([]);
  });

  it("requires --tessera-* names to be defined in src, even when the use has a fallback", () => {
    expect(check(".a { left: var(--tessera-x, 0px); }")).toEqual(["1:--tessera-x"]);
    expect(check(".a { left: var(--tessera-x); }", ["--tessera-x"])).toEqual([]);
  });

  it("scopes --tessera-* names to their own file or the other side of the pair", () => {
    const set = (...names: string[]) => new Set(names);
    const all = set("--tessera-a", "--tessera-b", "--color-brand");
    // a CSS file: its own definition, or a name some ts/tsx file sets via style
    const css = visibleOurTokens("css", set("--tessera-a"), all, set("--tessera-a", "--tessera-b"), set());
    expect([...css].sort()).toEqual(["--color-brand", "--tessera-a"]);
    const cssWithStyle = visibleOurTokens("css", set(), all, set("--tessera-a"), set("--tessera-b"));
    expect([...cssWithStyle].sort()).toEqual(["--color-brand", "--tessera-b"]);
    // a ts file: its own definition, or a name some CSS file defines
    const ts = visibleOurTokens("ts", set(), all, set("--tessera-a"), set("--tessera-b"));
    expect([...ts].sort()).toEqual(["--color-brand", "--tessera-a"]);
    const hits = undefinedTokenUses(tokenUses(".a { x: var(--tessera-b); y: var(--color-brand); }", "css"), astryx, css);
    expect(hits.map((h) => h.name)).toEqual(["--tessera-b"]);
  });

  it("allows the next/font names and skips template-built names", () => {
    expect(check("a { font-family: var(--font-body), var(--font-code); b: var(--spacing-${n}); }")).toEqual([]);
  });

  it("ignores comments and keeps line numbers", () => {
    const css = "/* var(--spacing-16)\n   var(--spacing-17) */\n.a { x: var(--spacing-18); }";
    expect(check(css)).toEqual(["3:--spacing-18"]);
    const ts = "// var(--spacing-16) in a note\nconst s = 'var(--spacing-19)'; // var(--spacing-20)\nconst u = 'https://x.dev/var(--spacing-21)';";
    expect(tokenUses(ts, "ts").map((u) => u.name)).toEqual(["--spacing-19", "--spacing-21"]);
    expect(stripComments("a /* b\nc */ d", "css")).toBe("a     \n     d");
  });

  it("reads definitions from CSS, quoted style keys and setProperty calls", () => {
    const names = definedTokens(
      [
        ":root { --color-x: red; }",
        'const style = { "--tessera-gantt-offset": 1, \'--tessera-gantt-span\': 2 };',
        'el.style.setProperty("--tessera-drag-x", "1px");',
        "// --tessera-in-comment: 1",
        "const use = `var(--color-y)`;",
      ].join("\n"),
      "ts",
    );
    expect([...names].sort()).toEqual(["--color-x", "--tessera-drag-x", "--tessera-gantt-offset", "--tessera-gantt-span"]);
  });
});
