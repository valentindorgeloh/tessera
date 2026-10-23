/**
 * Theme-wide input stacking (decision 14, touch option A), read from shell.css
 * because jsdom runs no layout. A text-like field's wrapper carries a 44px
 * `::before` hit area (the theme's text-input, tokenizer, number-input,
 * date-input and time-input), and a neighbour's area can reach over the field;
 * Playwright reported "intercepts pointer events". Under the touch media query
 * every Astryx text-like input is `position: relative`, so it paints above its
 * own wrapper's area and above earlier siblings' areas. No z-index: Astryx has
 * no z-index tokens, its popovers, menus and dialogs sit in the top layer, and a
 * z-index would paint a field over the sticky bands (z-index 1) it scrolls under.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const TOUCH_MEDIA = "@media (pointer: coarse), (max-width: 480px)";

/** The text between the braces of the first block whose prelude is `prelude`, with nested braces kept. */
function blockBody(source: string, prelude: string): string | undefined {
  const start = source.indexOf(`${prelude} {`);
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = start + prelude.length + 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + prelude.length + 2, i);
    }
  }
  return undefined;
}

const shell = stripComments(read("src/components/styles/shell.css"));
const touch = blockBody(shell, TOUCH_MEDIA) ?? "";
const ruleMatch = touch.match(/(:is\(\s*\.astryx-text-input[\s\S]*?textarea\.astryx-text-area-control)\s*\{([^}]*)\}/);

describe("input stacking (shell.css)", () => {
  it("has the rule under the touch media query", () => {
    expect(touch).not.toBe("");
    expect(ruleMatch, "the input stacking rule").not.toBeNull();
  });

  it("covers every text-like Astryx field: text, tokenizer, number, date, time, date-time, both selector searches and the text area", () => {
    const selector = ruleMatch?.[1] ?? "";
    for (const name of ["text-input", "tokenizer", "number-input", "date-input", "time-input", "date-time-input", "selector-search", "multi-selector-search"]) {
      expect(selector, name).toContain(`.astryx-${name}`);
    }
    expect(selector).toMatch(/\)\s*input,/);
    expect(selector).toMatch(/input:is\(\.astryx-selector-search, \.astryx-multi-selector-search\)/);
    expect(selector).toContain(".astryx-text-area textarea");
  });

  it("only positions the input: no z-index, so a sticky band (z-index 1) still paints over a field scrolled under it", () => {
    const declarations = (ruleMatch?.[2] ?? "").trim();
    expect(declarations).toBe("position: relative;");
    expect(touch).not.toMatch(/z-index/);
  });

  it("is not a desktop rule: nothing outside the touch query positions an input", () => {
    const outside = shell.replace(touch, "");
    expect(outside).not.toMatch(/\.astryx-text-input[^{]*input/);
    expect(outside).not.toMatch(/\.astryx-tokenizer[^{]*input/);
  });

  it("leaves the list lane's work-items filter rule alone", () => {
    expect(stripComments(read("src/components/styles/work-items.css"))).toMatch(/\.tessera-wi-search \.astryx-tokenizer input/);
  });
});
