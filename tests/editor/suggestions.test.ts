// @vitest-environment jsdom
/**
 * Suggestion triggers of the description editor (src/components/editor/
 * mentions.tsx, extensions.ts): the `@` and `#` triggers read the actors and
 * the search scope from the editor's own storage at query time, so the host
 * can update them without recreating the editor; the `/` and `@` row filters;
 * the `#` search request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, readSuggestionContext, setSuggestionContext } from "@/components/editor/extensions";
import { actorRows, blockRows, buildEditorSuggestions, suggestionAria, suggestionOptionId } from "@/components/editor/mentions";

const editors: Editor[] = [];

function headless(withMentions: boolean): Editor {
  const editor = new Editor({
    element: null,
    extensions: editorExtensions({ compact: true, mentions: withMentions ? buildEditorSuggestions() : null }),
    content: "",
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.unstubAllGlobals();
});

const ACTORS = [
  { id: "a1", name: "Nina Park" },
  { id: "a2", name: "Omar Diaz" },
  { id: "a3", name: "nils" },
];

describe("suggestion context", () => {
  it("starts empty and holds what setSuggestionContext writes, per editor", () => {
    const first = headless(false);
    const second = headless(false);
    expect(readSuggestionContext(first)).toEqual({ actors: [], projectId: null });
    setSuggestionContext(first, { actors: ACTORS, projectId: "p1" });
    expect(readSuggestionContext(first)).toEqual({ actors: ACTORS, projectId: "p1" });
    expect(readSuggestionContext(second)).toEqual({ actors: [], projectId: null });
    setSuggestionContext(first, { actors: [], projectId: null });
    expect(readSuggestionContext(first)).toEqual({ actors: [], projectId: null });
  });

  it("the @ trigger reads the actors current at query time", async () => {
    const editor = headless(true);
    const { at } = buildEditorSuggestions();
    const signal = new AbortController().signal;
    expect(await at.items?.({ query: "n", editor, signal })).toEqual([]);
    setSuggestionContext(editor, { actors: ACTORS, projectId: null });
    expect(await at.items?.({ query: "n", editor, signal })).toEqual([
      { id: "a1", label: "Nina Park" },
      { id: "a3", label: "nils" },
    ]);
  });

  it("the # trigger searches work items in the current scope", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ hits: [{ type: "work_item", id: "w1", project_id: "p1", key: "WEB-1", title: "Set up hosting", score: 1 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const editor = headless(true);
    const { workItem } = buildEditorSuggestions();
    const signal = new AbortController().signal;

    setSuggestionContext(editor, { actors: [], projectId: "p1" });
    const rows = await workItem.items?.({ query: "WEB-1", editor, signal });
    expect(rows).toEqual([{ id: "w1", label: "Set up hosting", token: "WEB-1", description: undefined }]);
    const first = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(first.pathname).toBe("/api/search");
    expect(Object.fromEntries(first.searchParams)).toEqual({ q: "WEB-1", types: "work_item", limit: "8", scope: "p1" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal });

    // Outside a project: no scope.
    setSuggestionContext(editor, { actors: [], projectId: null });
    await workItem.items?.({ query: "hosting", editor, signal });
    const second = new URL(String(fetchMock.mock.calls[1][0]), "http://localhost");
    expect(second.searchParams.has("scope")).toBe(false);
  });

  it("the # trigger shows nothing when the search fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const editor = headless(true);
    const { workItem } = buildEditorSuggestions();
    expect(await workItem.items?.({ query: "x", editor, signal: new AbortController().signal })).toEqual([]);
  });

  it("the [[ trigger is reserved and lists nothing until pages arrive", async () => {
    const editor = headless(true);
    const { page } = buildEditorSuggestions();
    expect(page.char).toBe("[[");
    expect(await page.items?.({ query: "spec", editor, signal: new AbortController().signal })).toEqual([]);
  });
});

describe("row filters", () => {
  it("actorRows matches a case-insensitive name prefix and keeps at most eight", () => {
    expect(actorRows(ACTORS, "NI").map((row) => row.id)).toEqual(["a1", "a3"]);
    expect(actorRows(ACTORS, " omar ").map((row) => row.id)).toEqual(["a2"]);
    expect(actorRows(ACTORS, "park")).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Alex ${i}` }));
    expect(actorRows(many, "")).toHaveLength(8);
  });

  it("blockRows lists the block commands whose label contains the query", () => {
    expect(blockRows("").map((row) => row.label)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bullet list",
      "Numbered list",
      "Task list",
      "Table",
      "Code block",
      "Quote",
      "Divider",
    ]);
    expect(blockRows("list").map((row) => row.id)).toEqual(["bullet-list", "ordered-list", "task-list"]);
    expect(blockRows("DIV").map((row) => row.id)).toEqual(["divider"]);
    expect(blockRows("nothing")).toEqual([]);
  });

  it("every block command turns the current block into its node", () => {
    const expected: Record<string, RegExp> = {
      "heading-1": /^# x$/,
      "heading-2": /^## x$/,
      "heading-3": /^### x$/,
      "bullet-list": /^- x$/,
      "ordered-list": /^1\. x$/,
      "task-list": /^- \[ \] x$/,
      table: /^\|.*\|$/m,
      "code-block": /^```\nx\n```$/,
      quote: /^> x$/,
      divider: /^---$/m,
    };
    for (const row of blockRows("")) {
      const editor = new Editor({ element: null, extensions: editorExtensions({ compact: true, mentions: null }), content: "x", contentType: "markdown" });
      editors.push(editor);
      row.run?.(editor);
      expect(editor.getMarkdown(), row.id).toMatch(expected[row.id]);
    }
  });
});

describe("suggestion list accessibility", () => {
  it("points the editor at the listbox and its active option", () => {
    expect(suggestionOptionId("list-1", 2)).toBe("list-1-option-2");
    expect(suggestionAria("list-1", 3, 2)).toEqual({
      "aria-autocomplete": "list",
      "aria-controls": "list-1",
      "aria-activedescendant": "list-1-option-2",
    });
  });

  it("drops the list and the active option while there are no rows", () => {
    expect(suggestionAria("list-1", 0, 0)).toEqual({ "aria-autocomplete": "list", "aria-controls": null, "aria-activedescendant": null });
  });
});
