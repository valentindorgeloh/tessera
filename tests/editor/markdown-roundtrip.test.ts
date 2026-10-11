// @vitest-environment jsdom
/**
 * Markdown round trip of the description editor (docs/contracts/editor.md,
 * "Vitest corpus"; docs/PLAN.md §12). A headless Tiptap Editor built from
 * the same extension list as the component parses each case and serialises
 * it back: the second cycle must reproduce the first, no word may be lost,
 * entity hrefs, raw HTML, task states and fence languages survive verbatim.
 * The corpus is an array so later phases append cases.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, encodeMarkdownText } from "@/components/editor/extensions";

type Case = {
  name: string;
  md: string;
  /** Substrings that must survive the first cycle verbatim. */
  keep?: string[];
};

const CYCLE_ID = "019505a0-7c5e-7000-8000-000000000001";
const MODULE_ID = "019505a0-7c5e-7000-8000-000000000002";

export const CORPUS: Case[] = [
  { name: "ATX headings 1-3", md: "# Heading one\n\n## Heading two\n\n### Heading three\n\nBody text." },
  {
    name: "inline marks and escapes",
    md: "Paragraph with **bold**, *italic*, ~~strike~~ and `inline code`, plus escaped \\* star, \\_ under and \\# hash.",
    keep: ["**bold**", "*italic*", "~~strike~~", "`inline code`"],
  },
  { name: "bullet list three deep", md: "- one\n  - two\n    - three\n- four" },
  { name: "ordered list three deep", md: "1. first\n   1. second\n      1. third\n2. fourth" },
  {
    name: "task lists nested in bullets",
    md: "- parent\n  - [ ] open task\n  - [x] done task\n    - [ ] deeper task\n- sibling",
    keep: ["[ ] open task", "[x] done task", "[ ] deeper task"],
  },
  {
    name: "GFM table with an escaped pipe",
    md: "| Name | Value | Note |\n| --- | --- | --- |\n| a | b \\| c | d |\n| e | f | g |",
    keep: ["\\|"],
  },
  {
    name: "fenced code with a language",
    md: "```ts\nconst x = 1; // # not a heading * not bold\n```",
    keep: ["```ts", "const x = 1; // # not a heading * not bold"],
  },
  { name: "fenced code without a language", md: "```\nplain # fence * here\n```", keep: ["plain # fence * here"] },
  { name: "blockquote with a nested list", md: "> quoted\n> - with a list\n> - inside" },
  { name: "horizontal rule", md: "Above\n\n---\n\nBelow", keep: ["---"] },
  { name: "hard line break", md: "line one  \nline two", keep: ["line one  \nline two"] },
  {
    name: "entity links and a web link",
    md: `[WEB-12](work:WEB-12) [Spec](page:spec-1) [Cycle](cycle:${CYCLE_ID}) [Mod](module:${MODULE_ID}) [Site](https://example.com/path)`,
    keep: ["(work:WEB-12)", "(page:spec-1)", `(cycle:${CYCLE_ID})`, `(module:${MODULE_ID})`, "(https://example.com/path)"],
  },
  { name: "bare URL", md: "Bare https://example.com/bare link.", keep: ["https://example.com/bare"] },
  { name: "actor mention as text", md: "Hello @Nina, please review.", keep: ["@Nina"] },
  { name: "raw block HTML", md: '<div class="note">keep me</div>', keep: ['<div class="note">keep me</div>'] },
  { name: "raw inline HTML", md: "Press <kbd>K</kbd> to open.", keep: ["<kbd>K</kbd>"] },
  { name: "image", md: "![alt text](https://example.com/a.png)", keep: ["![alt text](https://example.com/a.png)"] },
  { name: "three blank lines", md: "Before\n\n\n\nAfter three blank lines." },
  {
    name: "pasted description: table, nested task list and a work link",
    md: [
      "## Release checklist",
      "",
      "| Step | Owner | Done |",
      "| --- | --- | --- |",
      "| Build | Nina | yes |",
      "| Ship | Omar | no |",
      "",
      "- [ ] Prepare",
      "  - [x] Draft notes",
      "  - [ ] Review with [WEB-1](work:WEB-1)",
      "- [x] Announce",
      "",
      "Tracked in [WEB-1](work:WEB-1) and [Spec](page:spec-1).",
    ].join("\n"),
    // The serialiser pads table cells to the column width, so the table is checked by words, not verbatim.
    keep: ["- [ ] Prepare\n  - [x] Draft notes\n  - [ ] Review with [WEB-1](work:WEB-1)", "Tracked in [WEB-1](work:WEB-1) and [Spec](page:spec-1)."],
  },
  {
    name: "ampersands and angle brackets in plain text",
    md: "R&D -> a < b, Q&A and $5 < $10 > $1.",
    keep: ["R&D -> a < b, Q&A and $5 < $10 > $1."],
  },
  { name: "bare URL with a query string", md: "See https://x.test/a?b=1&c=2 now.", keep: ["https://x.test/a?b=1&c=2"] },
  {
    name: "everything together",
    md: [
      "# Title",
      "",
      "Intro with **bold** and [WEB-12](work:WEB-12).",
      "",
      "- [ ] todo",
      "- [x] done",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const y = 2;",
      "```",
      "",
      "<kbd>Enter</kbd> saves.",
    ].join("\n"),
    keep: ["(work:WEB-12)", "[x] done", "```ts", "<kbd>Enter</kbd>"],
  },
];

const words = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);

const extensions = editorExtensions({ compact: true, mentions: null });
const editors: Editor[] = [];

function parse(md: string): Editor {
  const editor = new Editor({ element: null, extensions, content: md, contentType: "markdown" });
  editors.push(editor);
  return editor;
}

function serialise(editor: Editor): string {
  return editor.getMarkdown();
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("markdown round trip", () => {
  it.each(CORPUS)("$name", ({ md, keep = [] }) => {
    const once = serialise(parse(md));
    const twice = serialise(parse(once));
    // Idempotent after one cycle.
    expect(twice).toBe(once);
    // Nothing dropped.
    const missing = words(md).filter((word) => !words(once).includes(word));
    expect(missing).toEqual([]);
    for (const fragment of keep) expect(once).toContain(fragment);
    // Task states are kept.
    expect((once.match(/\[x\]/g) ?? []).length).toBe((md.match(/\[x\]/g) ?? []).length);
    expect((once.match(/\[ \]/g) ?? []).length).toBe((md.match(/\[ \]/g) ?? []).length);
  });

  it("serialises an empty document as an empty string", () => {
    expect(serialise(parse(""))).toBe("");
  });

  it("serialises a # pick (key text with a work link mark) as an entity link", () => {
    const editor = parse("See ");
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, [
      { type: "text", text: "WEB-12", marks: [{ type: "link", attrs: { href: "work:WEB-12" } }] },
      { type: "text", text: " for details." },
    ]);
    const once = serialise(editor);
    expect(once).toBe("See [WEB-12](work:WEB-12) for details.");
    expect(serialise(parse(once))).toBe(once);
  });

  it("serialises an actor mention node as plain @Name that parses back as the same text", () => {
    const editor = parse("Ping ");
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, [
      { type: "mention", attrs: { id: "01a128aa-0000-7000-8000-000000000001", label: "Nina" } },
      { type: "text", text: " please." },
    ]);
    const once = serialise(editor);
    expect(once).toBe("Ping @Nina please.");
    expect(serialise(parse(once))).toBe(once);
  });

  it("writes no HTML entities for plain &, < and > (MCP and search readers see the text as typed)", () => {
    for (const { md } of CORPUS) expect(serialise(parse(md))).not.toMatch(/&(amp|lt|gt);/);
  });

  it("keeps the fenced language on a second edit", () => {
    const editor = parse("```ts\nlet a = 1;\n```");
    editor.commands.setContent("```py\nprint(1)\n```", { contentType: "markdown", emitUpdate: false });
    expect(serialise(editor)).toContain("```py");
  });
});

describe("plain text escaping", () => {
  /** A document with one paragraph holding `text` as typed (no Markdown parsing). */
  function typed(text: string): Editor {
    const editor = new Editor({ element: null, extensions, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });
    editors.push(editor);
    return editor;
  }

  it("stores typed &, < and > as typed", () => {
    expect(serialise(typed("R&D: a < b"))).toBe("R&D: a < b");
    expect(serialise(typed("a -> b and $5 < $10"))).toBe("a -> b and $5 < $10");
  });

  it("opens stored text with &, < and > unchanged, so the lossy-parse check stays quiet", () => {
    for (const md of ["a -> b", "Q&A", "$5 < $10", "R&D -> a < b", "x &copy; y", "1 <2 and 3> 2"]) expect(serialise(parse(md))).toBe(md);
  });

  it("escapes only what would read back as markup, and reads it back as the typed text", () => {
    const cases = [
      { text: "&amp; is an entity", md: "&amp;amp; is an entity" },
      { text: "tag <kbd> here", md: "tag &lt;kbd> here" },
      { text: "close </b> and <!-- note", md: "close &lt;/b> and &lt;!-- note" },
      { text: "> not a quote", md: "\\> not a quote" },
    ];
    for (const { text, md } of cases) {
      const once = serialise(typed(text));
      expect(once).toBe(md);
      const back = parse(once);
      expect(back.state.doc.firstChild?.type.name).toBe("paragraph");
      expect(back.state.doc.textContent).toBe(text);
      expect(serialise(back)).toBe(once);
    }
  });

  it("leaves code alone", () => {
    const inline = serialise(parse("Run `a < b && c > d` now."));
    expect(inline).toContain("`a < b && c > d`");
    const fenced = serialise(parse("```\nif (a < b && c > d) {}\n&lt;kept&gt;\n```"));
    expect(fenced).toContain("if (a < b && c > d) {}\n&lt;kept&gt;");
  });
});

describe("encodeMarkdownText", () => {
  it("keeps the package's backslash escapes", () => {
    expect(encodeMarkdownText("a*b_c[d]e~f`g\\h")).toBe("a\\*b\\_c\\[d\\]e\\~f\\`g\\\\h");
  });

  it("escapes & only before a decodable entity", () => {
    expect(encodeMarkdownText("R&D & Q&A")).toBe("R&D & Q&A");
    expect(encodeMarkdownText("&amp; &lt; &gt; &quot; &#38; &#x26;")).toBe("&amp;amp; &amp;lt; &amp;gt; &amp;quot; &amp;#38; &amp;#x26;");
    expect(encodeMarkdownText("&copy; &nbsp;")).toBe("&copy; &nbsp;");
  });

  it("escapes < only before a tag, comment, declaration or autolink", () => {
    expect(encodeMarkdownText("a < b, a<3, <-")).toBe("a < b, a<3, <-");
    expect(encodeMarkdownText("<b> </b> <!-- <?x <https://x.test>")).toBe("&lt;b> &lt;/b> &lt;!-- &lt;?x &lt;https://x.test>");
  });

  it("escapes > only at the start of a line", () => {
    expect(encodeMarkdownText("a -> b > c")).toBe("a -> b > c");
    expect(encodeMarkdownText("> quote\n> again")).toBe("\\> quote\n\\> again");
  });
});
