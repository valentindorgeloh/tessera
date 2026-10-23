// @vitest-environment jsdom
/**
 * Suggestion triggers of the description editor (src/components/editor/
 * mentions.tsx, extensions.ts): the `@` and `#` triggers read the actors and
 * the search scope from the editor's own storage at query time, so the host
 * can update them without recreating the editor; the `/` and `@` row filters;
 * the `#` search request.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, readSuggestionContext, setSuggestionContext } from "@/components/editor/extensions";
import { extractEntityRefs } from "@/lib/tessera/pages/embeds";
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
    expect(readSuggestionContext(first)).toEqual({ actors: [], projectId: null, pageId: null });
    setSuggestionContext(first, { actors: ACTORS, projectId: "p1", pageId: "pg-web" });
    expect(readSuggestionContext(first)).toEqual({ actors: ACTORS, projectId: "p1", pageId: "pg-web" });
    expect(readSuggestionContext(second)).toEqual({ actors: [], projectId: null, pageId: null });
    // A host that omits pageId clears it, so a recycled editor never keeps the previous page.
    setSuggestionContext(first, { actors: [], projectId: null });
    expect(readSuggestionContext(first)).toEqual({ actors: [], projectId: null, pageId: null });
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
});

describe("the [[ page trigger (decision 10)", () => {
  const WIKI_HIT = { type: "page", id: "pg-wiki", project_id: null, title: "Handbook", subtitle: "Wiki", score: 1 };
  const PROJECT_HIT = { type: "page", id: "pg-web", project_id: "p1", title: "Web spec", subtitle: "Website", score: 1 };
  const OTHER_PROJECT_HIT = { type: "page", id: "pg-ops", project_id: "p2", title: "Ops runbook", subtitle: "Ops", score: 1 };

  function stubSearch(answer: (url: URL) => unknown[] | Response) {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const result = answer(new URL(String(input), "http://localhost"));
      if (result instanceof Response) return result;
      return new Response(JSON.stringify({ hits: result }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("is configured like # (debounce, minimum query, no triggers inside code)", () => {
    const { page } = buildEditorSuggestions();
    expect(page.char).toBe("[[");
    expect(page.debounce).toBe(150);
    expect(page.minQueryLength).toBe(1);
    expect(page.allow).toBeTypeOf("function");
  });

  it("in a project it lists project pages first, then wiki pages, deduped and capped at eight", async () => {
    const fetchMock = stubSearch((url) =>
      url.searchParams.has("scope")
        ? [PROJECT_HIT]
        : [WIKI_HIT, OTHER_PROJECT_HIT, { ...PROJECT_HIT, project_id: null }, ...Array.from({ length: 9 }, (_, i) => ({ ...WIKI_HIT, id: `w${i}`, title: `Wiki ${i}` }))],
    );
    const editor = headless(true);
    const { page } = buildEditorSuggestions();
    setSuggestionContext(editor, { actors: [], projectId: "p1" });
    const signal = new AbortController().signal;
    const rows = await page.items?.({ query: "spec", editor, signal });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => new URL(String(call[0]), "http://localhost"));
    const scoped = urls.find((url) => url.searchParams.has("scope"));
    const unscoped = urls.find((url) => !url.searchParams.has("scope"));
    expect(Object.fromEntries(scoped?.searchParams ?? [])).toEqual({ q: "spec", types: "page", limit: "8", scope: "p1" });
    expect(Object.fromEntries(unscoped?.searchParams ?? [])).toEqual({ q: "spec", types: "page", limit: "20" });
    expect(scoped?.pathname).toBe("/api/search");

    expect(rows).toHaveLength(8);
    expect(rows?.[0]).toEqual({ id: "pg-web", label: "Web spec", description: "Website" });
    expect(rows?.[1]).toEqual({ id: "pg-wiki", label: "Handbook", description: "Wiki" });
    // The page of another project is left out, and a page seen twice shows once.
    expect(rows?.map((row) => row.id)).not.toContain("pg-ops");
    expect(new Set(rows?.map((row) => row.id)).size).toBe(rows?.length);
  });

  it("without a project (a wiki page) it makes one unscoped request and lists every hit", async () => {
    const fetchMock = stubSearch(() => [WIKI_HIT, PROJECT_HIT, OTHER_PROJECT_HIT]);
    const editor = headless(true);
    const { page } = buildEditorSuggestions();
    const rows = await page.items?.({ query: "o", editor, signal: new AbortController().signal });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "o", types: "page", limit: "8" });
    expect(rows?.map((row) => row.id)).toEqual(["pg-wiki", "pg-web", "pg-ops"]);
  });

  it("leaves the page being edited out of its own results and asks for one extra row (a self-link is dropped on save)", async () => {
    const wikiHits = Array.from({ length: 9 }, (_, i) => ({ ...WIKI_HIT, id: `w${i}`, title: `Wiki ${i}` }));
    const fetchMock = stubSearch((url) => (url.searchParams.has("scope") ? [PROJECT_HIT, ...wikiHits.slice(0, 7)] : wikiHits));
    const editor = headless(true);
    const { page } = buildEditorSuggestions();
    setSuggestionContext(editor, { actors: [], projectId: "p1", pageId: "pg-web" });
    const rows = await page.items?.({ query: "spec", editor, signal: new AbortController().signal });
    const urls = fetchMock.mock.calls.map((call) => new URL(String(call[0]), "http://localhost"));
    const scoped = urls.find((url) => url.searchParams.has("scope"));
    const unscoped = urls.find((url) => !url.searchParams.has("scope"));
    expect(Object.fromEntries(scoped?.searchParams ?? [])).toEqual({ q: "spec", types: "page", limit: "9", scope: "p1" });
    expect(Object.fromEntries(unscoped?.searchParams ?? [])).toEqual({ q: "spec", types: "page", limit: "20" });
    expect(rows?.map((row) => row.id)).not.toContain("pg-web");
    expect(rows).toHaveLength(8);
  });

  it("on a wiki page it drops the page itself and still returns eight rows", async () => {
    const hits = [WIKI_HIT, ...Array.from({ length: 8 }, (_, i) => ({ ...WIKI_HIT, id: `w${i}`, title: `Wiki ${i}` }))];
    const fetchMock = stubSearch(() => hits);
    const editor = headless(true);
    const { page } = buildEditorSuggestions();
    setSuggestionContext(editor, { actors: [], projectId: null, pageId: "pg-wiki" });
    const rows = await page.items?.({ query: "w", editor, signal: new AbortController().signal });
    expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0]), "http://localhost").searchParams)).toEqual({ q: "w", types: "page", limit: "9" });
    expect(rows).toHaveLength(8);
    expect(rows?.map((row) => row.id)).not.toContain("pg-wiki");
  });

  it("the page body editor hands its page id to the editor's suggestion context", () => {
    expect(readFileSync("src/components/pages/PageBodyEditor.tsx", "utf8")).toContain("pageId={pageId}");
    const editor = readFileSync("src/components/editor/MarkdownEditor.tsx", "utf8");
    expect(editor).toContain("setSuggestionContext(editor, { actors: mentionActors, projectId, pageId })");
    expect(editor).toContain("[editor, mentionActors, projectId, pageId]");
  });

  it("keeps the other half of the list when one request fails, and shows nothing when both do", async () => {
    stubSearch((url) => (url.searchParams.has("scope") ? new Response("{}", { status: 500 }) : [WIKI_HIT]));
    const editor = headless(true);
    const { page } = buildEditorSuggestions();
    setSuggestionContext(editor, { actors: [], projectId: "p1" });
    const signal = new AbortController().signal;
    expect((await page.items?.({ query: "h", editor, signal }))?.map((row) => row.id)).toEqual(["pg-wiki"]);
    stubSearch(() => new Response("{}", { status: 500 }));
    expect(await page.items?.({ query: "h", editor, signal })).toEqual([]);
  });

  it("a pick inserts the page name as a page: link and a space, which serialises to [Name](page:<id>)", () => {
    const editor = headless(true);
    editor.commands.setContent("see [[he", { contentType: "markdown" });
    const { page } = buildEditorSuggestions();
    const end = editor.state.doc.content.size - 1;
    const from = end - "[[he".length;
    page.command?.({ editor, range: { from, to: end }, props: { id: "pg-wiki", label: "Handbook" } });
    const markdown = editor.getMarkdown();
    expect(markdown).toBe("see [Handbook](page:pg-wiki) ");
    expect(editor.getHTML()).toContain('href="page:pg-wiki"');
    expect(extractEntityRefs(markdown)).toEqual([{ scheme: "page", ref: "pg-wiki" }]);
    // The space after the link is plain text: typing on does not extend the link.
    expect(editor.state.doc.textContent).toBe("see Handbook ");
  });

  it("the inserted link survives a Markdown round trip", () => {
    const editor = headless(true);
    editor.commands.setContent("Read [Handbook](page:pg-wiki) and [Web spec](page:pg-web) first.", { contentType: "markdown" });
    expect(editor.getMarkdown()).toBe("Read [Handbook](page:pg-wiki) and [Web spec](page:pg-web) first.");
    const again = headless(true);
    again.commands.setContent(editor.getMarkdown(), { contentType: "markdown" });
    expect(again.getMarkdown()).toBe(editor.getMarkdown());
  });

  it("says 'No pages match' when nothing is found", () => {
    const source = readFileSync("src/components/editor/mentions.tsx", "utf8");
    expect(source).toContain('createRenderer("No pages match", "Pages"');
    expect(source).not.toContain("Pages arrive in P6");
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
