/**
 * The page editor does not keep a 32px start padding on a phone (visual audit
 * "touch:editor 32px start padding at 375"): the padding reserves room for the
 * hover-only block drag handle, which a finger cannot use, so under
 * (pointer: coarse), (max-width: 480px) the inset equals the end inset and the
 * handle is hidden. jsdom has no layout, so this reads the stylesheet.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/components/styles/editor.css", "utf8");

function ruleBody(selector: string, source: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start));
}

describe("editor phone inset", () => {
  const media = css.indexOf("@media (pointer: coarse), (max-width: 480px) {\n  .tessera-editor-content {");
  it("keeps the 32px handle room on a fine pointer and resets it on touch", () => {
    expect(media).toBeGreaterThan(css.indexOf(".tessera-editor-content {"));
    expect(ruleBody(".tessera-editor-content", css)).toContain("padding-inline: var(--spacing-8) var(--spacing-4)");
    const block = css.slice(media, css.indexOf("\n}\n", media));
    expect(block).toContain("padding-inline-start: var(--spacing-4)");
  });

  it("hides the drag handle where the room is dropped", () => {
    const tail = css.slice(css.indexOf(".tessera-editor-drag:active"));
    expect(tail).toMatch(/@media \(pointer: coarse\), \(max-width: 480px\) \{\s*\.tessera-editor-drag \{\s*display: none;/);
  });
});
