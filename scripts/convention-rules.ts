/**
 * Pure helpers behind the convention gate's decision-reference and file-budget
 * checks (docs/process/swarm.md). scripts/check-conventions.ts runs on import,
 * so the logic lives here where Vitest can reach it.
 */

/** Source files over this many lines are on the ratchet (src/ and scripts/, tests excluded). */
export const FILE_BUDGET_LINES = 600;

/**
 * Numbers of the rows in the "Resolved design decisions" tables of docs/PLAN.md:
 * `| 7 |` gives "7", `| U6 |` gives "U6". Parsed, never hard-coded.
 */
export function parseDecisionNumbers(planText: string): Set<string> {
  const numbers = new Set<string>();
  let inSection = false;
  for (const line of planText.split("\n")) {
    if (/^##\s/.test(line)) inSection = /^##\s+Resolved design decisions\b/.test(line);
    if (!inSection) continue;
    const m = /^\|\s*(U?\d+)\s*\|/.exec(line);
    if (m) numbers.add(m[1]);
  }
  return numbers;
}

/** Comment text per source line (// and block comments), so string literals are not read as references. */
export function commentTexts(lines: string[]): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  lines.forEach((raw, i) => {
    let rest = raw;
    let text = "";
    while (rest.length > 0) {
      if (inBlock) {
        const end = rest.indexOf("*/");
        text += " " + (end === -1 ? rest : rest.slice(0, end));
        if (end === -1) break;
        inBlock = false;
        rest = rest.slice(end + 2);
        continue;
      }
      const block = rest.indexOf("/*");
      const lineComment = /(^|\s)\/\//.exec(rest);
      const lineAt = lineComment ? lineComment.index + lineComment[1].length : -1;
      if (lineAt !== -1 && (block === -1 || lineAt < block)) {
        text += " " + rest.slice(lineAt + 2);
        break;
      }
      if (block === -1) break;
      inBlock = true;
      rest = rest.slice(block + 2);
    }
    if (text !== "") out.push({ line: i + 1, text });
  });
  return out;
}

/** Decision numbers cited in a comment as `decision N`, `decision UN` or a list (`decisions 12, 13`, `decisions 5 and 7`), uppercased. */
export function decisionRefs(comment: string): string[] {
  const refs: string[] = [];
  const re = /\bdecisions? (U?\d+(?:(?:\s*,\s*|\s+and\s+|\s+to\s+|\s*&\s*)U?\d+)*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(comment)) !== null) for (const number of m[1].match(/U?\d+/gi) ?? []) refs.push(number.toUpperCase());
  return refs;
}

/** Cited numbers missing from `known`, with the line they appear on. */
export function unknownDecisionRefs(lines: string[], known: Set<string>): { line: number; number: string }[] {
  const out: { line: number; number: string }[] = [];
  for (const { line, text } of commentTexts(lines)) {
    for (const number of decisionRefs(text)) if (!known.has(number)) out.push({ line, number });
  }
  return out;
}

/** Same count as `wc -l` for newline-terminated files; a final unterminated line counts too. */
export function countLines(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export type BudgetResult = {
  /** Files that grew past their recorded count, or are over the limit and unlisted. */
  failures: { file: string; message: string }[];
  /** Listed files that shrank (or fell under the limit): lower or drop the json entry. */
  notes: string[];
  /** Over-limit files skipped because they are exempt. */
  exempt: string[];
};

/**
 * Ratchet: `counts` is path to current line count for every budgeted file,
 * `budget` is scripts/file-budget.json, `exempt` the paths excused until their phase.
 */
export function evaluateFileBudget(
  counts: Record<string, number>,
  budget: Record<string, number>,
  exempt: ReadonlySet<string>,
  limit: number = FILE_BUDGET_LINES,
): BudgetResult {
  const failures: BudgetResult["failures"] = [];
  const notes: string[] = [];
  const exemptOver: string[] = [];

  for (const file of Object.keys(counts).sort()) {
    const lines = counts[file];
    if (exempt.has(file)) {
      if (lines > limit) exemptOver.push(file);
      continue;
    }
    const recorded = budget[file];
    if (recorded === undefined) {
      if (lines > limit) failures.push({ file, message: `${lines} lines; the budget is ${limit}. Split the file (it is not on the ratchet list)` });
    } else if (lines > recorded) {
      failures.push({ file, message: `grew to ${lines} lines; the ratchet in scripts/file-budget.json allows ${recorded}` });
    }
  }

  for (const file of Object.keys(budget).sort()) {
    if (exempt.has(file)) continue;
    const lines = counts[file] ?? 0;
    if (lines < budget[file]) {
      notes.push(
        lines > limit
          ? `${file} shrank to ${lines} lines (recorded ${budget[file]}); lower scripts/file-budget.json`
          : `${file} is now ${lines} lines, within the budget; remove it from scripts/file-budget.json`,
      );
    }
  }

  return { failures, notes, exempt: exemptOver };
}

/**
 * Token families that Astryx defines (read from the installed astryx.css) plus the ones the gate
 * also guards although Astryx has none today (--z-, --line-height-): a var() of any of them must resolve.
 */
export const ASTRYX_TOKEN_FAMILIES = [
  "--spacing-",
  "--color-",
  "--radius-",
  "--font-",
  "--size-",
  "--shadow-",
  "--duration-",
  "--ease-",
  "--z-",
  "--border-",
  "--line-height-",
  "--text-",
];

/**
 * Names that are legitimately not in any CSS file. `next/font` sets --font-body and --font-code from
 * src/app/layout.tsx at runtime (a class on <html>), so no stylesheet and no Astryx file defines them.
 */
export const TOKEN_EXCEPTIONS: ReadonlySet<string> = new Set(["--font-body", "--font-code"]);

/** Our own custom properties, named like `--tessera-gantt-offset`. They follow the same file/pair rule as any name outside the Astryx families. */
export const TESSERA_TOKEN_PREFIX = "--tessera-";

/** Replaces comments with blanks, keeping every newline so line numbers stay true. `//` only counts after whitespace (URLs stay). */
export function stripComments(text: string, lang: "css" | "ts"): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (lang === "ts") out = out.replace(/(^|\s)\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));
  return out;
}

/** Custom properties a file defines: `--x:` in CSS, a quoted key such as `"--x":` in an inline style object, or `el.style.setProperty("--x", ...)`. */
export function definedTokens(text: string, lang: "css" | "ts"): Set<string> {
  const names = new Set<string>();
  const re = /(--[A-Za-z0-9_-]+)["']?\s*:/g;
  let m: RegExpExecArray | null;
  const src = stripComments(text, lang);
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  const setter = /setProperty\(\s*["'`](--[A-Za-z0-9_-]+)["'`]/g;
  while ((m = setter.exec(src)) !== null) names.add(m[1]);
  return names;
}

/** The var(--x) uses of a file with their line. Names built by a template (`var(--spacing-${n})`) are skipped. */
export function tokenUses(text: string, lang: "css" | "ts"): { line: number; name: string }[] {
  const out: { line: number; name: string }[] = [];
  stripComments(text, lang)
    .split("\n")
    .forEach((line, i) => {
      const re = /var\(\s*(--[A-Za-z0-9_-]+)(?![A-Za-z0-9_${-])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) out.push({ line: i + 1, name: m[1] });
    });
  return out;
}

/**
 * The names a file may use out of what src defines, for a name outside the Astryx families (--tessera-*, --focus-*, ...):
 * what the file defines itself, what a theme file defines (src/themes/**), and what the other side of the
 * css/ts pair defines. A CSS file may use a name that some ts/tsx file sets through a style prop or setProperty; a ts/tsx
 * file may use a name that some CSS file defines. Two CSS areas, or two components, cannot satisfy each other with the
 * same name. Astryx-family names are not in this set: they resolve only in Astryx or the theme (see undefinedTokenUses).
 */
export function visibleOurTokens(
  lang: "css" | "ts",
  own: ReadonlySet<string>,
  theme: ReadonlySet<string>,
  fromCss: ReadonlySet<string>,
  fromTs: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>([...theme, ...own]);
  for (const name of lang === "css" ? fromTs : fromCss) out.add(name);
  return out;
}

/**
 * Uses that resolve nowhere. `astryx` is every name in the installed Astryx CSS and `theme` every name the
 * Catppuccin theme (src/themes/**) defines; an Astryx-family name (--color-, --spacing-, ...) must be in one of
 * them, so a def somewhere else in src never silences it. Any other name must be in `astryx` or in `visible`, the
 * per-file set from visibleOurTokens (the same file, a theme file, or the other side of the css/ts pair).
 * Names in `exceptions` are skipped.
 */
export function undefinedTokenUses(
  uses: { line: number; name: string }[],
  astryx: ReadonlySet<string>,
  visible: ReadonlySet<string>,
  theme: ReadonlySet<string> = new Set(),
  exceptions: ReadonlySet<string> = TOKEN_EXCEPTIONS,
): { line: number; name: string; message: string }[] {
  const out: { line: number; name: string; message: string }[] = [];
  for (const { line, name } of uses) {
    if (exceptions.has(name)) continue;
    if (ASTRYX_TOKEN_FAMILIES.some((f) => name.startsWith(f))) {
      if (!astryx.has(name) && !theme.has(name)) {
        out.push({ line, name, message: `var(${name}) is not defined by Astryx or by the theme (src/themes/**); the whole declaration is invalid. Add it to the theme, not to an area file` });
      }
    } else if (!astryx.has(name) && !visible.has(name)) {
      out.push({ line, name, message: `var(${name}) is not defined in this file, a theme file, or the other side of its css/ts pair (a style prop or setProperty for CSS, a stylesheet for ts)` });
    }
  }
  return out;
}
